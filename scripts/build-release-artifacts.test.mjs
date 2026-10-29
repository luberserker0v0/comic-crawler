import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertReleaseRef, checksumFile, parseReleaseOptions } from './build-release-artifacts.mjs';

test('release artifact options use deterministic defaults', () => {
  assert.deepEqual(parseReleaseOptions([]), { output: '.artifacts/release', ref: undefined });
  assert.deepEqual(parseReleaseOptions(['--ref', 'v1.2.3', '--output', 'out']), {
    output: 'out', ref: 'v1.2.3',
  });
});

test('release ref must equal the project version tag', () => {
  assert.doesNotThrow(() => assertReleaseRef('v1.2.3', '1.2.3'));
  assert.throws(() => assertReleaseRef('main', '1.2.3'), /does not match/);
});

test('release checksum uses SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-release-'));
  const path = join(directory, 'asset.txt');
  try {
    await writeFile(path, 'abc', 'utf8');
    assert.equal(await checksumFile(path), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
