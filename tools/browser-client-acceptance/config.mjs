import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const ROOT_KEYS = new Set(['serverUrl', 'clientName', 'statePath', 'reconnectDelayMs', 'browser']);
const BROWSER_KEYS = new Set(['channel', 'headless', 'args', 'profile']);
const PROFILE_KEYS = new Set(['type', 'sourceUserDataRoot', 'sourceProfile']);

export async function loadAcceptanceConfig(configPath, stateOverride) {
  const absoluteConfigPath = resolve(configPath);
  const raw = JSON.parse(await readFile(absoluteConfigPath, 'utf8'));
  assertRecord(raw, 'config');
  rejectUnknownKeys(raw, ROOT_KEYS, 'config');
  requireString(raw.serverUrl, 'serverUrl');
  new URL(raw.serverUrl);

  const browser = raw.browser ?? {};
  assertRecord(browser, 'browser');
  rejectUnknownKeys(browser, BROWSER_KEYS, 'browser');
  if (browser.channel !== undefined) requireString(browser.channel, 'browser.channel');
  if (browser.headless !== undefined && typeof browser.headless !== 'boolean') {
    throw new Error('browser.headless must be a boolean.');
  }
  if (browser.args !== undefined && (!Array.isArray(browser.args) || browser.args.some((value) => typeof value !== 'string'))) {
    throw new Error('browser.args must be a string array.');
  }

  const profile = browser.profile ?? { type: 'fresh' };
  assertRecord(profile, 'browser.profile');
  rejectUnknownKeys(profile, PROFILE_KEYS, 'browser.profile');
  if (profile.type !== 'fresh' && profile.type !== 'copy') {
    throw new Error('browser.profile.type must be "fresh" or "copy".');
  }
  if (profile.type === 'copy') {
    requireString(profile.sourceUserDataRoot, 'browser.profile.sourceUserDataRoot');
    requireString(profile.sourceProfile, 'browser.profile.sourceProfile');
  }

  if (raw.clientName !== undefined) requireString(raw.clientName, 'clientName');
  if (raw.statePath !== undefined) requireString(raw.statePath, 'statePath');
  if (raw.reconnectDelayMs !== undefined && (!Number.isInteger(raw.reconnectDelayMs) || raw.reconnectDelayMs < 250)) {
    throw new Error('reconnectDelayMs must be an integer of at least 250.');
  }

  const baseDirectory = dirname(absoluteConfigPath);
  const statePath = resolveFrom(baseDirectory, stateOverride ?? raw.statePath ?? '.state/browser-client.json');
  return {
    serverUrl: new URL(raw.serverUrl).toString(),
    clientName: raw.clientName ?? 'production-acceptance-worker',
    statePath,
    reconnectDelayMs: raw.reconnectDelayMs ?? 2_000,
    browser: {
      channel: browser.channel ?? 'chrome',
      headless: browser.headless ?? false,
      args: [...(browser.args ?? [])],
      profile: profile.type === 'copy'
        ? {
            type: 'copy',
            sourceUserDataRoot: resolveFrom(baseDirectory, profile.sourceUserDataRoot),
            sourceProfile: profile.sourceProfile,
          }
        : { type: 'fresh' },
    },
  };
}

function resolveFrom(baseDirectory, value) {
  return isAbsolute(value) ? value : resolve(baseDirectory, value);
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown field(s): ${unknown.join(', ')}.`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}
