import { DEFAULTS } from '@comiccrawler/shared';
import type { GlobalConfig } from '@comiccrawler/shared';
import { basename } from 'node:path';

export interface RuntimeConfig {
  host: string;
  port: number;
  dataPath: string;
  agentWorkspacePath: string;
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
  const agentWorkspacePath = firstEnv(ENV_KEYS.agentWorkspacePath) ?? `${dataPath.replace(/[\\/]$/, '')}/agent-workspaces`;
  const staticDir = firstEnv(ENV_KEYS.staticDir);

  return {
    host,
    port,
    dataPath,
    agentWorkspacePath,
    staticDir,
  };
}

function defaultDataPath(): string {
  return basename(process.cwd()).toLowerCase() === 'backend' ? '../data' : './data';
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
