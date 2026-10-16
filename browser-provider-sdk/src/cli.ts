#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PlaywrightBrowserProvider } from './playwright-provider';
import {
  defaultCredentialPath,
  defaultProviderStatePath,
  loadProviderConfig,
  loadProviderState,
  readCredential,
  writeProviderFiles,
} from './provider-config';
import { registerBrowserProvider, ReverseRelayBrowserProviderClient } from './reverse-relay-client';

type Arguments = Record<string, string | boolean | undefined> & { command?: string };

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.command !== 'connect') {
    throw new Error('Usage: comiccrawler-browser-provider connect --config <path> [options]');
  }
  const config = await loadProviderConfig(requiredString(args, 'config'));
  const serverUrl = stringArg(args, 'server-url')
    ?? process.env.COMICCRAWLER_BROWSER_PROVIDER_SERVER_URL
    ?? config.serverUrl;

  const statePath = stringArg(args, 'state') ?? defaultProviderStatePath();
  let state = await loadProviderStateIfPresent(statePath);
  if (!state) {
    const inlineToken = stringArg(args, 'user-token');
    const tokenFile = stringArg(args, 'user-token-file') ?? config.authentication?.tokenFile;
    if (inlineToken && tokenFile) throw new Error('Use only one of --user-token or --user-token-file.');
    const userToken = inlineToken ?? (tokenFile ? (await fs.readFile(resolve(tokenFile), 'utf8')).trim() : undefined);
    const userId = stringArg(args, 'user-id') ?? config.authentication?.userId;
    const registration = await registerBrowserProvider({
      serverUrl,
      registration: {
        clientInstanceId: randomUUID(),
        providerName: stringArg(args, 'provider-name') ?? config.providerName,
      },
      userId,
      userToken,
    });
    const written = await writeProviderFiles({
      registration,
      serverUrl,
      stateOutput: statePath,
      credentialOutput: stringArg(args, 'credential'),
    });
    state = await loadProviderState(written.statePath);
    process.stdout.write(`Browser provider registered as ${registration.providerId}.\nState: ${written.statePath}\nCredential: ${written.credentialPath}\n`);
  }
  if (normalizeServerUrl(serverUrl) !== normalizeServerUrl(state.serverUrl)) {
    throw new Error(`Configured server URL does not match the registered server in ${statePath}. Use separate state and credential files for this server.`);
  }
  const credentialPath = stringArg(args, 'credential') ?? state.credential.file ?? defaultCredentialPath(statePath);
  const credential = await readCredential(credentialPath);
  let stopping = false;
  let activeClient: ReverseRelayBrowserProviderClient | undefined;
  const stop = () => {
    stopping = true;
    void activeClient?.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  let retryMs = 1000;
  while (!stopping) {
    const provider = new PlaywrightBrowserProvider({
      providerId: state.providerId,
      channel: stringArg(args, 'channel') ?? config.browser?.channel,
      headless: resolveHeadless(args, config.browser?.headless),
      maxSessions: numberArg(args, 'max-sessions') ?? config.sessions?.max,
      defaultTtlSeconds: numberArg(args, 'default-ttl') ?? config.sessions?.defaultTtlSeconds,
    });
    const client = new ReverseRelayBrowserProviderClient({ serverUrl, credential, provider });
    activeClient = client;
    try {
      process.stdout.write(`Connecting browser provider ${state.providerId} to ${serverUrl}...\n`);
      await client.connectOnce();
      retryMs = 1000;
    } catch (error) {
      process.stderr.write(`Browser provider connection failed: ${errorMessage(error)}\n`);
    } finally {
      await client.close();
      if (activeClient === client) activeClient = undefined;
    }
    if (!stopping) {
      await delay(retryMs);
      retryMs = Math.min(30_000, retryMs * 2);
    }
  }
}

async function loadProviderStateIfPresent(path: string) {
  try {
    return await loadProviderState(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function parseArguments(values: string[]): Arguments {
  const result: Arguments = {};
  const [command, ...rest] = values;
  result.command = command;
  for (let index = 0; index < rest.length; index++) {
    const token = rest[index]!;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'headed' || key === 'headless') {
      result[key] = true;
      continue;
    }
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
    result[key] = value;
  }
  return result;
}

function requiredString(args: Arguments, key: string): string {
  const value = stringArg(args, key);
  if (!value) throw new Error(`--${key} is required.`);
  return value;
}

function stringArg(args: Arguments, key: string): string | undefined {
  return typeof args[key] === 'string' ? args[key] as string : undefined;
}

function numberArg(args: Arguments, key: string): number | undefined {
  const value = stringArg(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${key} must be a number.`);
  return parsed;
}

function resolveHeadless(args: Arguments, configured = false): boolean {
  if (args.headed && args.headless) throw new Error('Use only one of --headed or --headless.');
  if (args.headed) return false;
  if (args.headless) return true;
  return configured;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
