import { describe, expect, it } from '@jest/globals';
import { ConfigManager } from '../../../src/config/manager';
import type { IStorage } from '../../../src/storage/types';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();

  async read<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async write(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(): Promise<string[]> {
    return [...this.values.keys()];
  }

  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

describe('ConfigManager', () => {
  it('migrates a persisted local-browser config to the remote-only schema', async () => {
    const storage = new MemoryStorage();
    storage.values.set('global', {
      download: {
        directory: './downloads',
        concurrency: 5,
        namingTemplate: '{title}/{chapter}/{index}',
        imageFormat: 'original',
        imageQuality: 100,
      },
      concurrency: { taskLevel: 3, siteLevel: 2 },
      network: { timeout: 30000, retries: 3, retryDelay: 1000 },
      browser: {
        mode: 'auto',
        headless: true,
        maxInstances: 2,
        timeout: 45000,
        waitUntil: 'domcontentloaded',
        postLoadDelayMs: 250,
        challengeAutoAttempt: true,
        challengeWaitMs: 15000,
        channel: 'chrome',
        userDataDir: './browser-profile',
        handoff: { mode: 'managed' },
      },
      server: { port: 4100, host: '127.0.0.1' },
      log: { level: 'info' },
      i18n: { language: 'zh-TW', fallback: 'en' },
      maintenance: {},
    });

    const loaded = await new ConfigManager(storage).load();
    const persisted = storage.values.get('global') as { browser: Record<string, unknown> };

    expect(loaded.browser).toMatchObject({
      mode: 'remote',
      timeout: 45000,
      postLoadDelayMs: 250,
      remote: { connectTimeout: 30000 },
    });
    expect(persisted.browser).not.toHaveProperty('headless');
    expect(persisted.browser).not.toHaveProperty('handoff');
    expect(persisted.browser).not.toHaveProperty('userDataDir');
  });
});
