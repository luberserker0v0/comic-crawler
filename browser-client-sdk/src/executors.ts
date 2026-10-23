import type {
  BrowserCapabilities,
  BrowserCommand,
  BrowserCommandResult,
  BrowserExecutor,
  BrowserRenderContext,
  BrowserResourceDescriptor,
  BrowserSession,
  OpenBrowserSessionRequest,
} from './contracts';
import { BrowserClientError } from './errors';

export interface BrowserPageDriver<PageHandle> {
  currentUrl(page: PageHandle, signal: AbortSignal): Promise<string>;
  navigate(page: PageHandle, url: string, signal: AbortSignal): Promise<string>;
  content(page: PageHandle, signal: AbortSignal): Promise<string>;
  waitForReady(page: PageHandle, timeoutMs: number | undefined, signal: AbortSignal): Promise<void>;
  prepareContent(page: PageHandle, strategy: 'scroll-through', timeoutMs: number | undefined, signal: AbortSignal): Promise<void>;
  focus(page: PageHandle, signal: AbortSignal): Promise<void>;
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

export abstract class AbstractBrowserExecutor implements BrowserExecutor {
  private closed = false;

  abstract describe(): Promise<BrowserCapabilities>;
  abstract openSession(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserSession>;

  async close(): Promise<void> {
    this.closed = true;
    await this.closeExecutor();
  }

  protected assertOpen(): void {
    if (this.closed) throw new BrowserClientError('Browser executor is closed.', 'INVALID_STATE');
  }

  protected async closeExecutor(): Promise<void> {}
}

export class ExistingTabExecutor<PageHandle> extends AbstractBrowserExecutor {
  private readonly resources = new Map<string, PageHandle>();
  private readonly activeResources = new Set<string>();

  constructor(private readonly driver: BrowserPageDriver<PageHandle>) {
    super();
  }

  async describe(): Promise<BrowserCapabilities> {
    return capabilities('existing-tab');
  }

  async registerResource(
    resource: BrowserResourceDescriptor,
    localHandle?: unknown
  ): Promise<void> {
    this.assertOpen();
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

  async openSession(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserSession> {
    this.assertOpen();
    if (request.source.type !== 'existing-resource') {
      throw new BrowserClientError('ExistingTabExecutor requires an existing-resource session.', 'INVALID_STATE');
    }
    const { resourceId, expectedUrl } = request.source;
    const page = this.resources.get(resourceId);
    if (!page) throw new BrowserClientError(`Browser resource "${resourceId}" is not registered.`, 'INVALID_STATE');
    if (this.activeResources.has(resourceId)) {
      throw new BrowserClientError(`Browser resource "${resourceId}" is busy.`, 'INVALID_STATE', true);
    }
    const actualUrl = await this.driver.currentUrl(page, signal);
    if (normalizeUrl(actualUrl) !== normalizeUrl(expectedUrl)) {
      throw new BrowserClientError('The registered browser tab is not on the requested URL.', 'INVALID_STATE');
    }
    this.activeResources.add(resourceId);
    return new DriverBrowserSession(this.driver, page, async () => {
      this.activeResources.delete(resourceId);
    });
  }

  protected override async closeExecutor(): Promise<void> {
    this.activeResources.clear();
    this.resources.clear();
  }
}

export class ManagedProfileExecutor<PageHandle> extends AbstractBrowserExecutor {
  private readonly activeProfiles = new Set<ManagedProfile<PageHandle>>();

  constructor(
    private readonly driver: BrowserPageDriver<PageHandle>,
    private readonly launcher: ManagedProfileLauncher<PageHandle>
  ) {
    super();
  }

  async describe(): Promise<BrowserCapabilities> {
    return capabilities('managed-profile');
  }

  async openSession(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserSession> {
    this.assertOpen();
    if (request.source.type !== 'managed-profile') {
      throw new BrowserClientError('ManagedProfileExecutor requires a managed-profile session.', 'INVALID_STATE');
    }
    const profile = await this.launcher.open({ renderContext: request.renderContext, signal });
    this.activeProfiles.add(profile);
    try {
      return new DriverBrowserSession(this.driver, profile.page, async () => {
        this.activeProfiles.delete(profile);
        await profile.close();
      }, profile.terminated);
    } catch (error) {
      this.activeProfiles.delete(profile);
      await profile.close().catch(() => undefined);
      throw error;
    }
  }

  protected override async closeExecutor(): Promise<void> {
    await Promise.all([...this.activeProfiles].map((profile) => profile.close().catch(() => undefined)));
    this.activeProfiles.clear();
    await this.launcher.close?.();
  }
}

class DriverBrowserSession<PageHandle> implements BrowserSession {
  private closed = false;

  constructor(
    private readonly driver: BrowserPageDriver<PageHandle>,
    private readonly page: PageHandle,
    private readonly closeSession: () => Promise<void>,
    readonly terminated?: Promise<void>
  ) {}

  async execute(command: BrowserCommand, signal: AbortSignal): Promise<BrowserCommandResult> {
    if (this.closed) throw new BrowserClientError('Browser session is closed.', 'BROWSER_CLOSED');
    switch (command.type) {
      case 'page.navigate':
        return { type: command.type, url: await this.driver.navigate(this.page, command.url, signal) };
      case 'page.get-url':
        return { type: command.type, url: await this.driver.currentUrl(this.page, signal) };
      default:
        return this.executePageCommand(command, signal);
    }
  }

  private async executePageCommand(command: BrowserCommand, signal: AbortSignal): Promise<BrowserCommandResult> {
    switch (command.type) {
      case 'page.get-content':
        return this.readContent(signal);
      case 'page.wait-for-ready':
        await this.driver.waitForReady(this.page, command.timeoutMs, signal);
        return { type: command.type, url: await this.driver.currentUrl(this.page, signal) };
      case 'page.prepare-content':
        await this.driver.prepareContent(this.page, command.strategy, command.timeoutMs, signal);
        return { type: command.type, url: await this.driver.currentUrl(this.page, signal) };
      case 'page.focus':
        await this.driver.focus(this.page, signal);
        return { type: command.type };
      default:
        throw new BrowserClientError(`Unsupported command "${command.type}".`, 'UNSUPPORTED_COMMAND');
    }
  }

  private async readContent(signal: AbortSignal): Promise<BrowserCommandResult> {
    return {
      type: 'page.get-content',
      url: await this.driver.currentUrl(this.page, signal),
      html: await this.driver.content(this.page, signal),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.closeSession();
  }
}

function capabilities(executionMode: BrowserCapabilities['executionMode']): BrowserCapabilities {
  return {
    executionMode,
    navigation: true,
    renderedDom: true,
    humanHandoff: true,
    responsiveViewport: executionMode === 'managed-profile',
  };
}

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}
