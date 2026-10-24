import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAcceptanceConfig } from '../config.mjs';

test('loads a fresh Profile config and resolves the state path', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-acceptance-config-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  await writeFile(path, JSON.stringify({
    serverUrl: 'https://crawler.example.test',
    executionMode: 'managed-profile',
    statePath: './private/state.json',
    browser: { profile: { type: 'fresh' } },
  }));

  const config = await loadAcceptanceConfig(path);
  assert.equal(config.serverUrl, 'https://crawler.example.test/');
  assert.equal(config.statePath, join(root, 'private', 'state.json'));
  assert.equal(config.executionMode, 'managed-profile');
  assert.deepEqual(config.browser.profile, { type: 'fresh' });
});

test('loads copy Profile paths relative to the config file', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-acceptance-copy-config-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  await writeFile(path, JSON.stringify(copyConfig()));

  const config = await loadAcceptanceConfig(path, './state/override.json');
  assert.equal(config.statePath, join(root, 'state', 'override.json'));
  assert.equal(config.executionMode, 'existing-tab');
  assert.equal(config.browser.profile.sourceUserDataRoot, join(root, 'chrome-data'));
  assert.equal(config.browser.profile.sourceProfile, 'Profile 1');
});

function copyConfig() {
  return {
    serverUrl: 'http://127.0.0.1:4100', executionMode: 'existing-tab',
    browser: { profile: { type: 'copy', sourceUserDataRoot: './chrome-data', sourceProfile: 'Profile 1' } },
  };
}

test('rejects unknown config fields', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-acceptance-invalid-config-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'config.json');
  await writeFile(path, JSON.stringify({
    serverUrl: 'http://127.0.0.1:4100',
    executionMode: 'existing-tab',
    browser: { mode: 'remote', profile: { type: 'fresh' } },
  }));

  await assert.rejects(() => loadAcceptanceConfig(path), /unknown field.*mode/i);
});
