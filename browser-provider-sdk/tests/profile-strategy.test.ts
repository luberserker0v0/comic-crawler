import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserProfileStrategy,
  EphemeralProfileStrategy,
  PlaywrightBrowserProvider,
  type BrowserProfileHandle,
  type BrowserProviderCapabilities,
} from '../src';

test('ephemeral profile is the production strategy and advertises no persistent profile support', () => {
  const strategy = new EphemeralProfileStrategy({ headless: false });

  assert(strategy instanceof BrowserProfileStrategy);
  assert.equal(strategy.kind, 'ephemeral');
  assert.equal(strategy.capabilities.headed, true);
  assert.equal(strategy.capabilities.interactive, true);
  assert.equal(strategy.capabilities.persistentContext, false);
});

test('Playwright provider delegates profile lifecycle through BrowserProfileStrategy', async () => {
  const strategy = new TestProfileStrategy();
  const provider = new PlaywrightBrowserProvider({
    providerId: 'strategy-test',
    profileStrategy: strategy,
  });

  const descriptor = await provider.describe();
  assert.deepEqual(descriptor.capabilities, strategy.capabilities);

  const session = await provider.createSession({
    requestedCapabilities: { interactive: true, persistentContext: false },
    ttlSeconds: 60,
  });
  assert.equal(strategy.launchCount, 1);
  assert.equal(session.localWsEndpoint, 'ws://127.0.0.1:4999/test');
  assert.equal(session.runtimeVersion, 'test-runtime');

  await provider.closeSession(session.sessionId);
  assert.equal(strategy.closeCount, 1);
  await provider.close();
  assert.equal(strategy.closeCount, 1);
});

class TestProfileStrategy extends BrowserProfileStrategy {
  readonly kind = 'ephemeral' as const;
  launchCount = 0;
  closeCount = 0;

  get capabilities(): BrowserProviderCapabilities {
    return {
      browser: 'chromium',
      headed: true,
      interactive: true,
      persistentContext: false,
      screenshots: true,
      downloads: true,
      tracing: true,
      fileTransfer: false,
    };
  }

  async launch(): Promise<BrowserProfileHandle> {
    this.launchCount += 1;
    return {
      localWsEndpoint: 'ws://127.0.0.1:4999/test',
      runtimeVersion: 'test-runtime',
      close: async () => undefined,
    };
  }

  override async close(handle: BrowserProfileHandle): Promise<void> {
    this.closeCount += 1;
    await super.close(handle);
  }
}
