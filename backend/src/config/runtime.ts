import { DEFAULTS } from '@comiccrawler/shared';
import type { GlobalConfig } from '@comiccrawler/shared';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

export interface DataDirectoryLayout {
  root: string;
  configPath: string;
  userPath: string;
  runtimePath: string;
  agentWorkspacePath: string;
  logsPath: string;
}

export interface RuntimeConfig {
  host: string;
  port: number;
  dataPath: string;
  agentWorkspacePath: string;
  dataLayout: DataDirectoryLayout;
  staticDir?: string;
}

export const ENV_KEYS = {
  host: ['COMICCRAWLER_HOST', 'HOST'],
  port: ['COMICCRAWLER_PORT', 'PORT'],
  dataPath: ['COMICCRAWLER_DATA_PATH', 'DATA_PATH'],
  agentWorkspacePath: ['AGENT_WORKSPACE_PATH'],
  staticDir: ['STATIC_DIR'],
} as const;

export function resolveRuntimeConfig(config?: Pick<GlobalConfig, 'server'>): RuntimeConfig {
  const envHost = firstEnv(ENV_KEYS.host);
  const configuredHost = config?.server.host;
  const host = envHost ?? normalizeLegacyDefaultHost(configuredHost) ?? DEFAULTS.server.host;
  const envPort = parsePort(firstEnv(ENV_KEYS.port));
  const port = envPort ?? normalizeLegacyDefaultPort(config?.server.port) ?? DEFAULTS.server.port;
  const dataPath = firstEnv(ENV_KEYS.dataPath) ?? defaultDataPath();
  const dataLayout = resolveDataDirectoryLayout(dataPath, firstEnv(ENV_KEYS.agentWorkspacePath));
  const agentWorkspacePath = dataLayout.agentWorkspacePath;
  const staticDir = firstEnv(ENV_KEYS.staticDir);

  return {
    host,
    port,
    dataPath,
    agentWorkspacePath,
    dataLayout,
    staticDir,
  };
}

export function resolveDataDirectoryLayout(dataPath = firstEnv(ENV_KEYS.dataPath) ?? defaultDataPath(), agentWorkspacePath = firstEnv(ENV_KEYS.agentWorkspacePath)): DataDirectoryLayout {
  const root = trimTrailingSlash(dataPath);
  return {
    root,
    configPath: join(root, 'config'),
    userPath: join(root, 'user'),
    runtimePath: join(root, 'runtime'),
    agentWorkspacePath: agentWorkspacePath ?? join(root, 'agent-workspaces'),
    logsPath: join(root, 'logs'),
  };
}

function defaultDataPath(): string {
  if (isProductionRuntime()) return defaultOsDataPath();
  return basename(process.cwd()).toLowerCase() === 'backend' ? '../data' : './data';
}

function defaultOsDataPath(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? homedir(), 'ComicCrawler');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'ComicCrawler');
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'comiccrawler');
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COMICCRAWLER_PACKAGED === '1';
}

function trimTrailingSlash(path: string): string {
  return path.replace(/[\\/]$/, '');
}

function normalizeLegacyDefaultHost(host?: string): string | undefined {
  if (!host) return undefined;
  return host === 'localhost' ? DEFAULTS.server.host : host;
}

function normalizeLegacyDefaultPort(port?: number): number | undefined {
  if (port === undefined) return undefined;
  return port === 3000 ? DEFAULTS.server.port : port;
}

function firstEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function parsePort(value?: string): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${value}". Expected an integer from 1 to 65535.`);
  }
  return port;
}
