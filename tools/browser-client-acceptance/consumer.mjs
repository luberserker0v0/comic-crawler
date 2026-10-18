import sdk from '@comiccrawler/browser-client-sdk';
import { chromium } from 'playwright';
import { FileClientStateStore, TemporaryProfileDirectoryAccess, nodeWebSocketFactory } from './node-runtime.mjs';

const {
  BrowserClient,
  CopyProfileProvisioner,
  FreshProfileProvisioner,
  ManagedProfileExecutor,
  PlaywrightManagedProfileLauncher,
  PlaywrightPageDriver,
} = sdk;

export function createAcceptanceConsumer(config) {
  const directories = new TemporaryProfileDirectoryAccess();
  const profile = config.browser.profile;
  const provisioner = profile.type === 'copy'
    ? new CopyProfileProvisioner(
        directories,
        profile.sourceUserDataRoot,
        profile.sourceProfile
      )
    : new FreshProfileProvisioner(directories);
  const args = [...config.browser.args];
  if (profile.type === 'copy') args.push(`--profile-directory=${profile.sourceProfile}`);
  const launcher = new PlaywrightManagedProfileLauncher(chromium, provisioner, {
    channel: config.browser.channel,
    headless: config.browser.headless,
    args,
  });
  const executor = new ManagedProfileExecutor(new PlaywrightPageDriver(), launcher);
  const stateStore = new FileClientStateStore(config.statePath);
  const client = new BrowserClient({
    serverUrl: config.serverUrl,
    executor,
    stateStore,
    webSocketFactory: nodeWebSocketFactory,
  });
  return { client, stateStore };
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
