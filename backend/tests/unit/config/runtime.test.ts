import { describe, expect, it, afterEach } from '@jest/globals';
import { resolveRuntimeConfig } from '../../../src/config/runtime';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('runtime config', () => {
  runtimeConfigTestGroup1();
});

function runtimeConfigTestGroup1(): void {
  it('uses persisted server config when env overrides are absent', runtimeConfigTestUsesPersistedServerConfigWhenEnvOverridesAreAbsent);
  it('lets COMICCRAWLER_* env vars override persisted server config', runtimeConfigTestLetsCOMICCRAWLEREnvVarsOverridePersistedServerConfig);
  it('uses OS app data path for packaged or production runtime when data env is absent', runtimeConfigTestUsesOSAppDataPathForPackagedOrProductionRuntimeWhenDataEnvIsAbsent);
  it('rejects invalid env ports early', runtimeConfigTestRejectsInvalidEnvPortsEarly);
  it('uses stored host and port without rewriting them', runtimeConfigTestUsesStoredHostAndPortWithoutRewritingThem);
}

function runtimeConfigTestUsesPersistedServerConfigWhenEnvOverridesAreAbsent() {
    delete process.env.COMICCRAWLER_PORT;
    delete process.env.COMICCRAWLER_HOST;
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
}

function runtimeConfigTestLetsCOMICCRAWLEREnvVarsOverridePersistedServerConfig() {
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
}

function runtimeConfigTestUsesOSAppDataPathForPackagedOrProductionRuntimeWhenDataEnvIsAbsent() {
    delete process.env.COMICCRAWLER_DATA_PATH;
    process.env.COMICCRAWLER_PACKAGED = '1';
    const runtime = resolveRuntimeConfig({ server: { port: 4200, host: '0.0.0.0' } });
    expect(runtime.dataPath).toContain(process.platform === 'linux' ? 'comiccrawler' : 'ComicCrawler');
    expect(runtime.dataPath).not.toBe('./data');
    expect(runtime.dataLayout.userPath).toContain('user');
    expect(runtime.dataLayout.agentWorkspacePath).toContain('agent-workspaces');
}

function runtimeConfigTestRejectsInvalidEnvPortsEarly() {
    process.env.COMICCRAWLER_PORT = '99999';
    expect(() => resolveRuntimeConfig({ server: { port: 4200, host: 'localhost' } })).toThrow(/Invalid port/);
}

function runtimeConfigTestUsesStoredHostAndPortWithoutRewritingThem() {
    delete process.env.COMICCRAWLER_PORT;
    delete process.env.COMICCRAWLER_HOST;
    expect(resolveRuntimeConfig({ server: { port: 3000, host: 'localhost' } })).toMatchObject({
        port: 3000,
        host: 'localhost',
    });
}
