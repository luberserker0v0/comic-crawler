import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { BrowserProviderRegistrationResponse, BrowserProviderState } from './contracts';

export interface BrowserProviderClientConfig {
  serverUrl: string;
  providerName?: string;
  authentication?: {
    userId: string;
    tokenFile: string;
  };
  browser?: {
    headless?: boolean;
    channel?: string;
  };
  sessions?: {
    max?: number;
    defaultTtlSeconds?: number;
  };
}

export async function loadProviderConfig(path: string): Promise<BrowserProviderClientConfig> {
  const config = JSON.parse(await fs.readFile(resolve(path), 'utf8')) as BrowserProviderClientConfig;
  const url = new URL(config.serverUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provider config serverUrl must use http:// or https://.');
  }
  return { ...config, serverUrl: url.href.replace(/\/$/, '') };
}

export async function loadProviderState(path = defaultProviderStatePath()): Promise<BrowserProviderState> {
  const state = JSON.parse(await fs.readFile(resolve(path), 'utf8')) as BrowserProviderState;
  if (state.schemaVersion !== 2 || !state.providerId || !state.clientInstanceId || !state.credential?.file) {
    throw new Error(`Invalid browser provider state: ${path}`);
  }
  return state;
}

export function defaultProviderStatePath(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? homedir(), 'ComicCrawler', 'browser-provider', 'provider-state.json');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'ComicCrawler', 'browser-provider', 'provider-state.json');
  }
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'comiccrawler', 'browser-provider', 'provider-state.json');
}

export function defaultCredentialPath(statePath: string): string {
  return join(dirname(resolve(statePath)), 'provider.credential');
}

export async function writeProviderFiles(input: {
  registration: BrowserProviderRegistrationResponse;
  serverUrl: string;
  stateOutput?: string;
  credentialOutput?: string;
}): Promise<{ statePath: string; credentialPath: string }> {
  const statePath = resolve(input.stateOutput ?? defaultProviderStatePath());
  const credentialPath = resolve(input.credentialOutput ?? defaultCredentialPath(statePath));
  await Promise.all([fs.mkdir(dirname(statePath), { recursive: true }), fs.mkdir(dirname(credentialPath), { recursive: true })]);
  await fs.writeFile(credentialPath, `${input.registration.credential}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    const state: BrowserProviderState = {
      schemaVersion: 2,
      providerId: input.registration.providerId,
      clientInstanceId: input.registration.clientInstanceId,
      serverUrl: input.serverUrl,
      credential: {
        type: 'provider-token',
        credentialId: input.registration.credentialId,
        file: credentialPath.replace(/\\/g, '/'),
      },
      registeredAt: input.registration.registeredAt,
    };
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    await fs.unlink(credentialPath).catch(() => undefined);
    throw error;
  }
  return { statePath, credentialPath };
}

export async function readCredential(path: string): Promise<string> {
  const value = (await fs.readFile(resolve(path), 'utf8')).trim();
  if (!value) throw new Error(`Browser provider credential is empty: ${path}`);
  return value;
}
