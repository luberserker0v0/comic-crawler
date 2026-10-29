import type { BrowserRenderContext, ReaderPreparationSelectors } from './contracts';
import { beginScrollableContentPreparation } from './content-preparation';
import type { BrowserContentPreparation, BrowserPageDriver,
  ManagedProfile, ManagedProfileLauncher } from './executors';
import { BrowserClientError } from './errors';

export interface PreparedProfile {
  userDataDir: string;
  release(): Promise<void>;
}

export interface ProfileProvisioner {
  prepare(signal: AbortSignal): Promise<PreparedProfile>;
}

export interface ProfileDirectoryAccess {
  createTemporaryDirectory(prefix: string): Promise<string>;
  removeDirectory(path: string): Promise<void>;
  copyChromeProfile?(input: {
    sourceUserDataRoot: string;
    sourceProfile: string;
    targetUserDataRoot: string;
    excludedNames: readonly string[];
    signal: AbortSignal;
  }): Promise<void>;
}

export class FreshProfileProvisioner implements ProfileProvisioner {
  constructor(
    private readonly directories: ProfileDirectoryAccess,
    private readonly prefix = 'comiccrawler-profile-'
  ) {}

  async prepare(signal: AbortSignal): Promise<PreparedProfile> {
    assertNotAborted(signal);
    const userDataDir = await this.directories.createTemporaryDirectory(this.prefix);
    return disposableProfile(userDataDir, this.directories);
  }
}

export class CopyProfileProvisioner implements ProfileProvisioner {
  static readonly excludedNames = [
    'Cache',
    'Code Cache',
    'GPUCache',
    'GrShaderCache',
    'ShaderCache',
    'SingletonCookie',
    'SingletonLock',
    'SingletonSocket',
  ] as const;

  constructor(
    private readonly directories: ProfileDirectoryAccess,
    private readonly sourceUserDataRoot: string,
    private readonly sourceProfile: string,
    private readonly prefix = 'comiccrawler-profile-copy-'
  ) {}

  async prepare(signal: AbortSignal): Promise<PreparedProfile> {
    assertNotAborted(signal);
    if (!this.directories.copyChromeProfile) {
      throw new BrowserClientError('Copy profile provisioning is not supported by this directory adapter.', 'INVALID_STATE');
    }
    const userDataDir = await this.directories.createTemporaryDirectory(this.prefix);
    try {
      await this.directories.copyChromeProfile({
        sourceUserDataRoot: this.sourceUserDataRoot,
        sourceProfile: this.sourceProfile,
        targetUserDataRoot: userDataDir,
        excludedNames: CopyProfileProvisioner.excludedNames,
        signal,
      });
      return disposableProfile(userDataDir, this.directories);
    } catch (error) {
      await this.directories.removeDirectory(userDataDir).catch(() => undefined);
      throw error;
    }
  }
}

export interface PlaywrightPageLike {
  url(): string;
  goto(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>;
  content(): Promise<string>;
  waitForLoadState(state: 'domcontentloaded', options?: { timeout?: number }): Promise<void>;
  evaluate<R, A>(pageFunction: (argument: A) => R | Promise<R>, argument: A): Promise<R>;
  bringToFront(): Promise<void>;
}

export interface PlaywrightBrowserContextLike<Page extends PlaywrightPageLike> {
  pages(): Page[];
  newPage(): Promise<Page>;
  close(): Promise<void>;
  once?(event: 'close', listener: () => void): void;
}

export interface PlaywrightChromiumLike<Page extends PlaywrightPageLike> {
  launchPersistentContext(userDataDir: string, options: {
    channel?: string;
    headless?: boolean;
    args?: string[];
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    userAgent?: string;
  }): Promise<PlaywrightBrowserContextLike<Page>>;
}

export interface PlaywrightManagedProfileOptions {
  channel?: string;
  headless?: boolean;
  args?: string[];
}

export class PlaywrightPageDriver<Page extends PlaywrightPageLike> implements BrowserPageDriver<Page> {
  async currentUrl(page: Page, signal: AbortSignal): Promise<string> {
    assertNotAborted(signal);
    return page.url();
  }

  async navigate(page: Page, url: string, signal: AbortSignal): Promise<string> {
    await raceAbort(page.goto(url, { waitUntil: 'domcontentloaded' }), signal);
    return page.url();
  }

  content(page: Page, signal: AbortSignal): Promise<string> {
    return raceAbort(page.content(), signal);
  }

  async waitForReady(page: Page, timeoutMs: number | undefined, signal: AbortSignal): Promise<void> {
    await raceAbort(page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }), signal);
  }

  async prepareContent(
    page: Page,
    strategy: 'scroll-through',
    reader: ReaderPreparationSelectors | undefined,
    signal: AbortSignal
  ): Promise<BrowserContentPreparation> {
    signal.throwIfAborted();
    if (strategy !== 'scroll-through') {
      throw new BrowserClientError(`Unsupported content preparation strategy "${strategy}".`, 'UNSUPPORTED_COMMAND');
    }
    return beginScrollableContentPreparation(
      (script, argument) => page.evaluate(script, argument), reader);
  }

  async focus(page: Page, signal: AbortSignal): Promise<void> {
    await raceAbort(page.bringToFront(), signal);
  }
}

export class PlaywrightManagedProfileLauncher<Page extends PlaywrightPageLike>
implements ManagedProfileLauncher<Page> {
  constructor(
    private readonly chromium: PlaywrightChromiumLike<Page>,
    private readonly provisioner: ProfileProvisioner,
    private readonly options: PlaywrightManagedProfileOptions = {}
  ) {}

  async open(input: { renderContext?: BrowserRenderContext; signal: AbortSignal }): Promise<ManagedProfile<Page>> {
    const prepared = await this.provisioner.prepare(input.signal);
    let context: PlaywrightBrowserContextLike<Page> | undefined;
    try {
      context = await this.launchContext(prepared.userDataDir, input);
      const page = context.pages()[0] ?? await context.newPage();
      return managedProfile(page, context, prepared);
    } catch (error) {
      await context?.close().catch(() => undefined);
      await prepared.release().catch(() => undefined);
      throw error;
    }
  }

  private launchContext(
    userDataDir: string,
    input: { renderContext?: BrowserRenderContext; signal: AbortSignal }
  ): Promise<PlaywrightBrowserContextLike<Page>> {
    const operation = this.chromium.launchPersistentContext(userDataDir, {
      channel: this.options.channel ?? 'chrome',
      headless: this.options.headless ?? false,
      args: mergeArguments(this.options.args),
      ...toPlaywrightContext(input.renderContext),
    });
    return raceAbort(operation, input.signal);
  }
}

function managedProfile<Page extends PlaywrightPageLike>(
  page: Page,
  context: PlaywrightBrowserContextLike<Page>,
  prepared: PreparedProfile
): ManagedProfile<Page> {
  let closed = false;
  return { page, terminated: contextCloseSignal(context), close: async () => {
    if (closed) return;
    closed = true;
    try {
      await context.close();
    } finally {
      await prepared.release();
    }
  } };
}

function contextCloseSignal<Page extends PlaywrightPageLike>(
  context: PlaywrightBrowserContextLike<Page>
): Promise<void> | undefined {
  if (!context.once) return undefined;
  return new Promise((resolve) => context.once!('close', resolve));
}

function disposableProfile(userDataDir: string, directories: ProfileDirectoryAccess): PreparedProfile {
  let released = false;
  return {
    userDataDir,
    release: async () => {
      if (released) return;
      released = true;
      await directories.removeDirectory(userDataDir);
    },
  };
}

function mergeArguments(args: string[] | undefined): string[] {
  const required = '--disable-blink-features=AutomationControlled';
  return args?.includes(required) ? [...args] : [required, ...(args ?? [])];
}

function toPlaywrightContext(renderContext: BrowserRenderContext | undefined): Partial<BrowserRenderContext> {
  if (!renderContext) return {};
  return {
    viewport: renderContext.viewport,
    deviceScaleFactor: renderContext.deviceScaleFactor,
    isMobile: renderContext.isMobile,
    hasTouch: renderContext.hasTouch,
    userAgent: renderContext.userAgent,
  };
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserClientError('Browser operation was cancelled.', 'CANCELLED');
}

function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  assertNotAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new BrowserClientError('Browser operation was cancelled.', 'CANCELLED'));
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      }
    );
  });
}
