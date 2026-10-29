import type {
  BrowserCapabilities,
  BrowserCommand,
  BrowserCommandResult,
  BrowserExecutionMode,
  BrowserExecutor,
  BrowserRenderContext,
  BrowserResourceDescriptor,
  BrowserSession,
  OpenBrowserSessionRequest,
  ReaderPreparationBudget,
  ReaderPreparationProgress,
  ReaderPreparationSelectors,
} from './contracts';
import { BrowserClientError } from './errors';

export interface BrowserPageDriver<PageHandle> {
  currentUrl(page: PageHandle, signal: AbortSignal): Promise<string>;
  navigate(page: PageHandle, url: string, signal: AbortSignal): Promise<string>;
  content(page: PageHandle, signal: AbortSignal): Promise<string>;
  waitForReady(page: PageHandle, timeoutMs: number | undefined, signal: AbortSignal): Promise<void>;
  prepareContent(page: PageHandle, strategy: 'scroll-through',
    reader: ReaderPreparationSelectors | undefined, signal: AbortSignal): Promise<BrowserContentPreparation>;
  focus(page: PageHandle, signal: AbortSignal): Promise<void>;
}

export interface BrowserContentPreparation {
  readonly progress: ReaderPreparationProgress;
  step(budget: ReaderPreparationBudget, signal: AbortSignal): Promise<ReaderPreparationProgress>;
  finish(): Promise<void>;
}

export interface BrowserPageLease<PageHandle> {
  page: PageHandle;
  terminated?: Promise<void>;
  release(): Promise<void>;
}

export interface BrowserPageAcquisitionStrategy<PageHandle> {
  readonly executionMode: BrowserExecutionMode;
  readonly responsiveViewport: boolean;
  acquire(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserPageLease<PageHandle>>;
  registerResource?(resource: BrowserResourceDescriptor, localHandle?: unknown): Promise<void>;
  revokeResource?(resourceId: string): Promise<void>;
  close(): Promise<void>;
}

export interface ManagedProfile<PageHandle> {
  page: PageHandle;
  terminated?: Promise<void>;
  close(): Promise<void>;
}

export interface ManagedProfileLauncher<PageHandle> {
  open(options: { renderContext?: BrowserRenderContext; signal: AbortSignal }): Promise<ManagedProfile<PageHandle>>;
  close?(): Promise<void>;
}

export class DriverBrowserExecutor<PageHandle> implements BrowserExecutor {
  private closed = false;

  constructor(
    private readonly driver: BrowserPageDriver<PageHandle>,
    private readonly acquisition: BrowserPageAcquisitionStrategy<PageHandle>
  ) {}

  async describe(): Promise<BrowserCapabilities> {
    return capabilities(this.acquisition.executionMode, this.acquisition.responsiveViewport);
  }

  async registerResource(resource: BrowserResourceDescriptor, localHandle?: unknown): Promise<void> {
    this.assertOpen();
    const register = this.acquisition.registerResource;
    if (!register) throw unsupportedResourceOperation(this.acquisition.executionMode, 'register');
    await register.call(this.acquisition, resource, localHandle);
  }

  async revokeResource(resourceId: string): Promise<void> {
    this.assertOpen();
    const revoke = this.acquisition.revokeResource;
    if (!revoke) throw unsupportedResourceOperation(this.acquisition.executionMode, 'revoke');
    await revoke.call(this.acquisition, resourceId);
  }

  async openSession(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserSession> {
    this.assertOpen();
    const lease = await this.acquisition.acquire(request, signal);
    return new DriverBrowserSession(this.driver, lease.page, () => lease.release(), lease.terminated);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.acquisition.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new BrowserClientError('Browser executor is closed.', 'INVALID_STATE');
  }
}

export class ExistingTabAcquisitionStrategy<PageHandle>
implements BrowserPageAcquisitionStrategy<PageHandle> {
  readonly executionMode = 'existing-tab' as const;
  readonly responsiveViewport = false;
  private readonly resources = new Map<string, PageHandle>();
  private readonly activeResources = new Set<string>();

  constructor(private readonly driver: BrowserPageDriver<PageHandle>) {}

  async registerResource(resource: BrowserResourceDescriptor, localHandle?: unknown): Promise<void> {
    if (resource.kind !== 'tab' || localHandle === undefined || localHandle === null) {
      throw new BrowserClientError('An existing-tab resource requires a local tab handle.', 'INVALID_STATE');
    }
    this.resources.set(resource.resourceId, localHandle as PageHandle);
  }

  async revokeResource(resourceId: string): Promise<void> {
    if (this.activeResources.has(resourceId)) {
      throw new BrowserClientError('The browser resource is in use.', 'INVALID_STATE', true);
    }
    this.resources.delete(resourceId);
  }

  async acquire(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserPageLease<PageHandle>> {
    const source = requireExistingResource(request);
    const page = this.resources.get(source.resourceId);
    if (!page) throw new BrowserClientError(`Browser resource "${source.resourceId}" is not registered.`, 'INVALID_STATE');
    if (this.activeResources.has(source.resourceId)) {
      throw new BrowserClientError(`Browser resource "${source.resourceId}" is busy.`, 'INVALID_STATE', true);
    }
    await assertExpectedUrl(this.driver, page, source.expectedUrl, signal);
    this.activeResources.add(source.resourceId);
    return { page, release: async () => { this.activeResources.delete(source.resourceId); } };
  }

  async close(): Promise<void> {
    this.activeResources.clear();
    this.resources.clear();
  }
}

export class ManagedProfileAcquisitionStrategy<PageHandle>
implements BrowserPageAcquisitionStrategy<PageHandle> {
  readonly executionMode = 'managed-profile' as const;
  readonly responsiveViewport = true;
  private readonly activeProfiles = new Set<ManagedProfile<PageHandle>>();

  constructor(private readonly launcher: ManagedProfileLauncher<PageHandle>) {}

  async acquire(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserPageLease<PageHandle>> {
    if (request.source.type !== 'managed-profile') {
      throw new BrowserClientError('Managed profile acquisition requires a managed-profile session.', 'INVALID_STATE');
    }
    const profile = await this.launcher.open({ renderContext: request.renderContext, signal });
    this.activeProfiles.add(profile);
    return { page: profile.page, terminated: profile.terminated,
      release: () => this.releaseProfile(profile) };
  }

  async close(): Promise<void> {
    await Promise.all([...this.activeProfiles].map((profile) => profile.close().catch(() => undefined)));
    this.activeProfiles.clear();
    await this.launcher.close?.();
  }

  private async releaseProfile(profile: ManagedProfile<PageHandle>): Promise<void> {
    if (!this.activeProfiles.delete(profile)) return;
    await profile.close();
  }
}

class DriverBrowserSession<PageHandle> implements BrowserSession {
  private closed = false;
  private preparation?: { operationId: string; operation: BrowserContentPreparation };

  constructor(
    private readonly driver: BrowserPageDriver<PageHandle>,
    private readonly page: PageHandle,
    private readonly releasePage: () => Promise<void>,
    readonly terminated?: Promise<void>
  ) {}

  async execute(command: BrowserCommand, signal: AbortSignal): Promise<BrowserCommandResult> {
    if (this.closed) throw new BrowserClientError('Browser session is closed.', 'BROWSER_CLOSED');
    if (command.type === 'page.navigate') {
      return { type: command.type, url: await this.driver.navigate(this.page, command.url, signal) };
    }
    if (command.type === 'page.get-url') {
      return { type: command.type, url: await this.driver.currentUrl(this.page, signal) };
    }
    return this.executePageCommand(command, signal);
  }

  private async executePageCommand(command: BrowserCommand, signal: AbortSignal): Promise<BrowserCommandResult> {
    if (command.type === 'page.get-content') return this.readContent(signal);
    if (command.type === 'page.wait-for-ready') {
      await this.driver.waitForReady(this.page, command.timeoutMs, signal);
      return { type: command.type, url: await this.driver.currentUrl(this.page, signal) };
    }
    if (command.type === 'page.prepare.start') return this.startPreparation(command, signal);
    if (command.type === 'page.prepare.step') return this.stepPreparation(command, signal);
    if (command.type === 'page.prepare.finish') return this.finishPreparation(command);
    if (command.type === 'page.focus') {
      await this.driver.focus(this.page, signal);
      return { type: command.type };
    }
    throw new BrowserClientError(`Unsupported command "${command.type}".`, 'UNSUPPORTED_COMMAND');
  }

  private async startPreparation(
    command: Extract<BrowserCommand, { type: 'page.prepare.start' }>, signal: AbortSignal
  ): Promise<BrowserCommandResult> {
    if (this.preparation) throw new BrowserClientError('Reader preparation is already active.', 'INVALID_STATE');
    const operation = await this.driver.prepareContent(this.page, command.strategy, command.reader, signal);
    this.preparation = { operationId: command.operationId, operation };
    return { type: command.type, operationId: command.operationId, progress: operation.progress };
  }

  private async stepPreparation(
    command: Extract<BrowserCommand, { type: 'page.prepare.step' }>, signal: AbortSignal
  ): Promise<BrowserCommandResult> {
    const active = this.requirePreparation(command.operationId);
    const progress = await active.operation.step(command.budget, signal);
    return { type: command.type, operationId: command.operationId, progress };
  }

  private async finishPreparation(
    command: Extract<BrowserCommand, { type: 'page.prepare.finish' }>
  ): Promise<BrowserCommandResult> {
    const active = this.requirePreparation(command.operationId);
    this.preparation = undefined;
    await active.operation.finish();
    const signal = new AbortController().signal;
    return { type: command.type, operationId: command.operationId,
      url: await this.driver.currentUrl(this.page, signal) };
  }

  private requirePreparation(operationId: string) {
    if (this.preparation?.operationId === operationId) return this.preparation;
    throw new BrowserClientError('Reader preparation operation does not match the active operation.', 'INVALID_STATE');
  }

  private async readContent(signal: AbortSignal): Promise<BrowserCommandResult> {
    return { type: 'page.get-content', url: await this.driver.currentUrl(this.page, signal),
      html: await this.driver.content(this.page, signal) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.closePreparation();
    } finally {
      await this.releasePage();
    }
  }

  private async closePreparation(): Promise<void> {
    const active = this.preparation;
    this.preparation = undefined;
    await active?.operation.finish();
  }
}

function capabilities(executionMode: BrowserExecutionMode, responsiveViewport: boolean): BrowserCapabilities {
  return { executionMode, navigation: true, renderedDom: true, humanHandoff: true, responsiveViewport };
}

function requireExistingResource(request: OpenBrowserSessionRequest) {
  if (request.source.type !== 'existing-resource') {
    throw new BrowserClientError('Existing tab acquisition requires an existing-resource session.', 'INVALID_STATE');
  }
  return request.source;
}

async function assertExpectedUrl<PageHandle>(
  driver: BrowserPageDriver<PageHandle>, page: PageHandle, expectedUrl: string, signal: AbortSignal
): Promise<void> {
  const actualUrl = await driver.currentUrl(page, signal);
  if (normalizeUrl(actualUrl) !== normalizeUrl(expectedUrl)) {
    throw new BrowserClientError('The registered browser tab is not on the requested URL.', 'INVALID_STATE');
  }
}

function unsupportedResourceOperation(mode: BrowserExecutionMode, operation: string): BrowserClientError {
  return new BrowserClientError(`${mode} acquisition cannot ${operation} browser resources.`, 'INVALID_STATE');
}

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}
