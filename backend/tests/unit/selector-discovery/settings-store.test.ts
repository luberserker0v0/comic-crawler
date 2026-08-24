import { describe, expect, it } from '@jest/globals';
import { SelectorDiscoverySettingsStore } from '../../../src/selector-discovery/settings-store';
import type { IStorage } from '../../../src/storage/types';

class MemoryStorage implements IStorage {
  private readonly values = new Map<string, unknown>();

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
    return Array.from(this.values.keys());
  }

  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

describe('SelectorDiscoverySettingsStore', () => {
  it('updates AO URL and model while reusing the saved provider document', async () => {
    const storage = new MemoryStorage();
    const store = new SelectorDiscoverySettingsStore(storage);
    const providerDocument = {
      provider: {
        opencode: {
          models: {
            'big-pickle': { name: 'big-pickle' },
            'mimo-v2.5-free': { name: 'mimo-v2.5-free' },
          },
        },
      },
    };

    await store.save({
      aoBaseUrl: 'http://localhost:32768',
      model: 'opencode/mimo-v2.5-free',
      providerDocument,
    });
    const updated = await store.save({
      aoBaseUrl: 'http://localhost:32768/',
      model: 'opencode/big-pickle',
    });

    expect(updated).toMatchObject({
      configured: true,
      aoBaseUrl: 'http://localhost:32768',
      model: 'opencode/big-pickle',
      modelIds: ['opencode/big-pickle', 'opencode/mimo-v2.5-free'],
    });
    await expect(store.getRequired()).resolves.toMatchObject({
      providerDocument,
    });
  });

  it('requires a provider document when no saved provider exists', async () => {
    const store = new SelectorDiscoverySettingsStore(new MemoryStorage());

    await expect(store.save({
      aoBaseUrl: 'http://localhost:32768',
      model: 'opencode/big-pickle',
    })).rejects.toThrow('Provider document is required.');
  });

  it('allows selecting AO built-in OpenCode models that are not in the custom provider document', async () => {
    const storage = new MemoryStorage();
    const store = new SelectorDiscoverySettingsStore(storage);
    const providerDocument = {
      provider: {
        my_local_lmstudio: {
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://host.docker.internal:25555/v1', apiKey: 'nopassword' },
          models: {
            'gemma-local': { name: 'gemma-local' },
          },
        },
      },
    };

    await store.save({
      aoBaseUrl: 'http://localhost:32768',
      model: 'my_local_lmstudio/gemma-local',
      providerDocument,
    });
    const updated = await store.save({
      aoBaseUrl: 'http://localhost:32768',
      model: 'opencode/big-pickle',
    });

    expect(updated).toMatchObject({
      model: 'opencode/big-pickle',
      providerIds: expect.arrayContaining(['my_local_lmstudio', 'opencode']),
      modelIds: expect.arrayContaining(['my_local_lmstudio/gemma-local', 'opencode/big-pickle']),
    });
  });
});
