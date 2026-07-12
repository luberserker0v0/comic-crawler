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

    const runtime = resolveRuntimeConfig({ server: { port: 4200, host: '0.0.0.0' } });
    expect(runtime).toMatchObject({
      port: 4200,
      host: '0.0.0.0',
      dataPath: '../data',
    });
    expect(runtime.agentWorkspacePath).toMatch(/\.\.[\\/]data[\\/]agent-workspaces$/);
    expect(runtime.dataLayout.root).toBe('../data');
    expect(runtime.dataLayout.configPath).toMatch(/[\\/]config$/);
    expect(runtime.dataLayout.userPath).toMatch(/[\\/]user$/);
    expect(runtime.dataLayout.runtimePath).toMatch(/[\\/]runtime$/);
    expect(runtime.dataLayout.agentWorkspacePath).toMatch(/[\\/]agent-workspaces$/);
    expect(runtime.dataLayout.logsPath).toMatch(/[\\/]logs$/);
  });

  it('lets COMICCRAWLER_* env vars override persisted server config', () => {
    process.env.COMICCRAWLER_PORT = '3200';
    process.env.COMICCRAWLER_HOST = '127.0.0.1';
    process.env.COMICCRAWLER_DATA_PATH = './runtime-data';
    process.env.AGENT_WORKSPACE_PATH = './custom-agent-workspaces';

    expect(resolveRuntimeConfig({ server: { port: 4200, host: '0.0.0.0' } })).toMatchObject({
      port: 3200,
      host: '127.0.0.1',
      dataPath: './runtime-data',
      agentWorkspacePath: './custom-agent-workspaces',
      dataLayout: {
        root: './runtime-data',
        agentWorkspacePath: './custom-agent-workspaces',
      },
    });
  });

  it('uses OS app data path for packaged or production runtime when data env is absent', () => {
    delete process.env.COMICCRAWLER_DATA_PATH;
    delete process.env.DATA_PATH;
    process.env.COMICCRAWLER_PACKAGED = '1';

    const runtime = resolveRuntimeConfig({ server: { port: 4200, host: '0.0.0.0' } });

    expect(runtime.dataPath).toContain(process.platform === 'linux' ? 'comiccrawler' : 'ComicCrawler');
    expect(runtime.dataPath).not.toBe('./data');
    expect(runtime.dataLayout.userPath).toContain('user');
    expect(runtime.dataLayout.agentWorkspacePath).toContain('agent-workspaces');
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
