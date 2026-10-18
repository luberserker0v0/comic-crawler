import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileClientStateStore, TemporaryProfileDirectoryAccess } from '../node-runtime.mjs';

test('persists Browser Client state without printing or splitting the credential', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-acceptance-state-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'private', 'state.json');
  const store = new FileClientStateStore(path);
  const state = {
    schemaVersion: 1,
    serverUrl: 'https://crawler.example.test/',
    clientId: 'client-1',
    credentialId: 'credential-1',
    credential: 'secret-value',
    registeredAt: new Date().toISOString(),
  };

  assert.equal(await store.get(), undefined);
  await store.set(state);
  assert.deepEqual(await store.get(), state);
  await store.clear();
  assert.equal(await store.get(), undefined);
});

test('copies a Chrome Profile and excludes cache and lock entries', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-acceptance-profile-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  await mkdir(join(source, 'Default', 'Cache'), { recursive: true });
  await writeFile(join(source, 'Default', 'Cookies'), 'cookies');
  await writeFile(join(source, 'Default', 'Cache', 'cache.bin'), 'cache');
  await writeFile(join(source, 'Local State'), 'local-state');

  const directories = new TemporaryProfileDirectoryAccess();
  const target = await directories.createTemporaryDirectory('comiccrawler-profile-test-');
  await directories.copyChromeProfile({
    sourceUserDataRoot: source,
    sourceProfile: 'Default',
    targetUserDataRoot: target,
    excludedNames: ['Cache', 'SingletonLock'],
    signal: new AbortController().signal,
  });

  assert.equal(await readFile(join(target, 'Default', 'Cookies'), 'utf8'), 'cookies');
  assert.equal(await readFile(join(target, 'Local State'), 'utf8'), 'local-state');
  await assert.rejects(() => access(join(target, 'Default', 'Cache')));
  await directories.removeDirectory(target);
  await assert.rejects(() => access(target));
});

test('refuses copy mode while the source Chrome User Data is locked', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-acceptance-locked-profile-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'Default'), { recursive: true });
  await writeFile(join(root, 'SingletonLock'), 'locked');
  const directories = new TemporaryProfileDirectoryAccess();
  const target = await directories.createTemporaryDirectory('comiccrawler-profile-test-');

  await assert.rejects(() => directories.copyChromeProfile({
    sourceUserDataRoot: root,
    sourceProfile: 'Default',
    targetUserDataRoot: target,
    excludedNames: ['SingletonLock'],
    signal: new AbortController().signal,
  }), /locked/);
  await directories.removeDirectory(target);
});
