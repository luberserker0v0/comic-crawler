import sdk from '@comiccrawler/browser-client-sdk';
import { chromium } from 'playwright';
import { FileClientStateStore, TemporaryProfileDirectoryAccess, nodeWebSocketFactory } from './node-runtime.mjs';

const {
  BrowserClient,
  CopyProfileProvisioner,
  ExistingTabAcquisitionStrategy,
  FreshProfileProvisioner,
  DriverBrowserExecutor,
  ManagedProfileAcquisitionStrategy,
  PlaywrightManagedProfileLauncher,
  PlaywrightPageDriver,
} = sdk;

export function createAcceptanceConsumer(config, options = {}) {
  const directories = new TemporaryProfileDirectoryAccess();
  const profile = config.browser.profile;
  const provisioner = createProvisioner(directories, profile);
  const browserType = options.chromium ?? chromium;
  const components = createBrowserComponents(config, provisioner, browserType, options);
  const stateStore = new FileClientStateStore(config.statePath);
  const client = createClient(config, components.executor, stateStore);
  return { client, stateStore, runtime: components.createRuntime(client) };
}

function createBrowserComponents(config, provisioner, browserType, options) {
  return config.executionMode === 'existing-tab'
    ? createExistingTabComponents(config, provisioner, browserType, options)
    : createManagedProfileComponents(config, provisioner, browserType);
}

function createManagedProfileComponents(config, provisioner, browserType) {
  const launcher = new PlaywrightManagedProfileLauncher(browserType, provisioner, browserOptions(config));
  const driver = new PlaywrightPageDriver();
  const executor = new DriverBrowserExecutor(driver, new ManagedProfileAcquisitionStrategy(launcher));
  return { executor, createRuntime: () => noOpRuntime() };
}

function createExistingTabComponents(config, provisioner, browserType, options) {
  const driver = new PlaywrightPageDriver();
  const executor = new DriverBrowserExecutor(driver, new ExistingTabAcquisitionStrategy(driver));
  return { executor, createRuntime: (client) => new ExistingTabAcceptanceRuntime({
    client, provisioner, browserType, launchOptions: browserOptions(config),
    onRegistered: options.onRegistered, onRevoked: options.onRevoked, onError: options.onError,
  }) };
}

function createClient(config, executor, stateStore) {
  return new BrowserClient({
    serverUrl: config.serverUrl,
    executor,
    stateStore,
    webSocketFactory: nodeWebSocketFactory,
  });
}

function createProvisioner(directories, profile) {
  return profile.type === 'copy'
    ? new CopyProfileProvisioner(directories, profile.sourceUserDataRoot, profile.sourceProfile)
    : new FreshProfileProvisioner(directories);
}

function browserArguments(browser) {
  const args = [...browser.args];
  if (browser.profile.type === 'copy') args.push(`--profile-directory=${browser.profile.sourceProfile}`);
  const automationArgument = '--disable-blink-features=AutomationControlled';
  if (!args.includes(automationArgument)) args.unshift(automationArgument);
  return args;
}

function browserOptions(config) {
  return {
    channel: config.browser.channel,
    headless: config.browser.headless,
    args: browserArguments(config.browser),
  };
}

function noOpRuntime() {
  return { async start() {}, async close() {} };
}

export class ExistingTabAcceptanceRuntime {
  constructor(options) {
    Object.assign(this, options);
    this.resources = new Map();
    this.controller = new AbortController();
  }

  async start(signal) {
    if (this.context) return;
    linkAbort(signal, this.controller);
    this.prepared = await this.provisioner.prepare(this.controller.signal);
    try {
      await this.launchBrowser();
      this.tracking = this.trackTabs();
    } catch (error) {
      await this.releasePrepared();
      throw error;
    }
  }

  async launchBrowser() {
    this.context = await this.browserType.launchPersistentContext(this.prepared.userDataDir, this.launchOptions);
    if (this.context.pages().length === 0) await this.context.newPage();
  }

  async trackTabs() {
    while (!this.controller.signal.aborted) {
      await this.synchronizeTabs().catch((error) => this.reportError(error));
      await delay(500, this.controller.signal);
    }
  }

  async synchronizeTabs() {
    if (!this.client.getConnection() || !this.context) return;
    const pages = new Set(this.context.pages());
    await this.revokeMissingPages(pages);
    for (const page of pages) await this.synchronizePage(page);
  }

  async revokeMissingPages(pages) {
    for (const page of this.resources.keys()) {
      if (!pages.has(page)) await this.revokePage(page);
    }
  }

  async synchronizePage(page) {
    const url = page.url();
    if (!isShareablePage(url)) return void await this.revokePage(page);
    const current = this.resources.get(page);
    if (current?.url === url) return;
    if (current && !await this.revokePage(page)) return;
    await this.registerPage(page, url);
  }

  async registerPage(page, url) {
    try {
      const title = await page.title().catch(() => undefined);
      const resource = await this.client.registerResource({ kind: 'tab', url, title, localHandle: page });
      this.resources.set(page, resource);
      this.onRegistered?.(resource);
    } catch (error) { this.reportError(error); }
  }

  async revokePage(page) {
    const resource = this.resources.get(page);
    if (!resource) return true;
    try {
      await this.client.revokeResource(resource.resourceId);
      this.resources.delete(page);
      this.onRevoked?.(resource);
      return true;
    } catch (error) {
      if (!isBusyResourceError(error)) this.reportError(error);
      return false;
    }
  }

  reportError(error) {
    this.onError?.(error);
  }

  async close() {
    this.controller.abort();
    await this.tracking?.catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.resources.clear();
    await this.releasePrepared();
  }

  async releasePrepared() {
    const prepared = this.prepared;
    this.prepared = undefined;
    await prepared?.release().catch(() => undefined);
  }
}

function isShareablePage(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

function isBusyResourceError(error) {
  return error instanceof Error && /resource.*in use|resource.*busy/i.test(error.message);
}

function linkAbort(source, target) {
  if (source.aborted) target.abort();
  else source.addEventListener('abort', () => target.abort(), { once: true });
}

export async function keepConnected(client, options = {}) {
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const signal = options.signal;
  let previousWorkerId;

  while (!signal?.aborted) {
    try {
      const connection = await client.connect();
      previousWorkerId = connection.workerId;
      options.onConnected?.(connection);
      while (!signal?.aborted && client.getConnection()) await delay(250, signal);
      if (!signal?.aborted) options.onDisconnected?.(previousWorkerId);
    } catch (error) {
      if (signal?.aborted) break;
      options.onConnectionError?.(error);
    }
    if (!signal?.aborted) await delay(reconnectDelayMs, signal);
  }
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    const aborted = () => done();
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
