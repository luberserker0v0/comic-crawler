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
  adapterTrustStorePath: string;
}

export const ENV_KEYS = {
  host: 'COMICCRAWLER_HOST',
  port: 'COMICCRAWLER_PORT',
  dataPath: 'COMICCRAWLER_DATA_PATH',
  agentWorkspacePath: 'AGENT_WORKSPACE_PATH',
  staticDir: 'STATIC_DIR',
  adapterTrustStorePath: 'COMICCRAWLER_ADAPTER_TRUST_STORE_PATH',
  maintenanceEnabled: 'COMICCRAWLER_MAINTENANCE_ENABLED',
  maintenanceIntervalHours: 'COMICCRAWLER_MAINTENANCE_INTERVAL_HOURS',
  maintenanceTasksRetainDays: 'COMICCRAWLER_MAINTENANCE_TASKS_RETAIN_DAYS',
  maintenanceJobsRetainDays: 'COMICCRAWLER_MAINTENANCE_JOBS_RETAIN_DAYS',
  maintenanceDeleteFiles: 'COMICCRAWLER_MAINTENANCE_DELETE_FILES',
} as const;

export function resolveRuntimeConfig(config?: Pick<GlobalConfig, 'server'>): RuntimeConfig {
  const envHost = readEnv(ENV_KEYS.host);
  const configuredHost = config?.server.host;
  const host = envHost ?? configuredHost ?? DEFAULTS.server.host;
  const envPort = parsePort(readEnv(ENV_KEYS.port));
  const port = envPort ?? config?.server.port ?? DEFAULTS.server.port;
  const dataPath = readEnv(ENV_KEYS.dataPath) ?? defaultDataPath();
  const dataLayout = resolveDataDirectoryLayout(dataPath, readEnv(ENV_KEYS.agentWorkspacePath));
  const agentWorkspacePath = dataLayout.agentWorkspacePath;
  const staticDir = readEnv(ENV_KEYS.staticDir);
  const adapterTrustStorePath = resolveAdapterTrustStorePath(dataLayout);
  return { host, port, dataPath, agentWorkspacePath, dataLayout, staticDir, adapterTrustStorePath };
}

function resolveAdapterTrustStorePath(layout: DataDirectoryLayout): string {
  return readEnv(ENV_KEYS.adapterTrustStorePath) ?? join(layout.configPath, 'adapter-registries.json');
}

export function resolveDataDirectoryLayout(dataPath = readEnv(ENV_KEYS.dataPath) ?? defaultDataPath(), agentWorkspacePath = readEnv(ENV_KEYS.agentWorkspacePath)): DataDirectoryLayout {
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

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value?.trim() || undefined;
}

function parsePort(value?: string): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${value}". Expected an integer from 1 to 65535.`);
  }
  return port;
}
