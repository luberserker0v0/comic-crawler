import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clean } from './clean.mjs';

test('default clean removes reproducible output and preserves runtime data', async (context) => {
  const root = await createRoot(context);
  await createFile(root, 'backend/dist/index.js');
  await createFile(root, '.artifacts/playwright/report/index.html');
  await createFile(root, '.artifacts/dev-logs/backend.log');
  await createFile(root, 'data/adapter-catalog/index.json', 'important');

  const removed = await clean(root, 'all', () => undefined);

  assert.deepEqual(removed, ['backend/dist', '.artifacts/playwright', '.artifacts/dev-logs']);
  assert.equal(await readFile(join(root, 'data/adapter-catalog/index.json'), 'utf-8'), 'important');
});

test('dependency clean does not remove runtime data', async (context) => {
  const root = await createRoot(context);
  await createFile(root, 'node_modules/example/index.js');
  await createFile(root, 'backend/downloads/chapter/001.jpg', 'image');

  const removed = await clean(root, 'deps', () => undefined);

  assert.deepEqual(removed, ['node_modules']);
  assert.equal(await readFile(join(root, 'backend/downloads/chapter/001.jpg'), 'utf-8'), 'image');
});

async function createRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'comiccrawler-clean-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createFile(root, relativePath, content = 'generated') {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf-8');
}
