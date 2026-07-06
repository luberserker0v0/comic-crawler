import { describe, expect, it, afterEach } from '@jest/globals';
import { resolveRuntimeConfig } from '../../../src/config/runtime';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('runtime config', () => {
  it('uses persisted server config when env overrides are absent', () => {
    delete process.env.COMICCRAWLER_PORT;
    delete process.env.PORT;
    delete process.env.COMICCRAWLER_HOST;
    delete process.env.HOST;

    expect(resolveRuntimeConfig({ server: { port: 4200, host: '0.0.0.0' } })).toMatchObject({
      port: 4200,
      host: '0.0.0.0',
      dataPath: './data',
      agentWorkspacePath: './data/agent-workspaces',
    });
  });

  it('lets COMICCRAWLER_* env vars override persisted server config', () => {
    process.env.COMICCRAWLER_PORT = '3200';
    process.env.COMICCRAWLER_HOST = '127.0.0.1';
    process.env.COMICCRAWLER_DATA_PATH = './runtime-data';

    expect(resolveRuntimeConfig({ server: { port: 4200, host: '0.0.0.0' } })).toMatchObject({
      port: 3200,
      host: '127.0.0.1',
      dataPath: './runtime-data',
      agentWorkspacePath: './runtime-data/agent-workspaces',
    });
  });

  it('rejects invalid env ports early', () => {
    process.env.COMICCRAWLER_PORT = '99999';

    expect(() => resolveRuntimeConfig({ server: { port: 4200, host: 'localhost' } })).toThrow(/Invalid port/);
  });

  it('normalizes legacy default host and port from existing stored config', () => {
    delete process.env.COMICCRAWLER_PORT;
    delete process.env.PORT;
    delete process.env.COMICCRAWLER_HOST;
    delete process.env.HOST;

    expect(resolveRuntimeConfig({ server: { port: 3000, host: 'localhost' } })).toMatchObject({
      port: 4100,
      host: '127.0.0.1',
    });
  });
});
