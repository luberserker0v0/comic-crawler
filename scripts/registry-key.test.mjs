import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');

test('registry key command writes a key bundle and rejects overwrite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-registry-key-'));
    try {
      const output = await runScript(directory);
      assert.match(output, /ADAPTER_REGISTRY_PRIVATE_KEY/);
      assert.match(output, /Never commit or publish it/);
      await verifyBundle(directory);
      await assert.rejects(runScript(directory), /Refusing to overwrite/);
    }
    finally { await removeTestDirectory(directory); }
});

test('registry key command defaults to the invocation directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comiccrawler-registry-key-'));
  try {
    await runScriptWithDefault(directory);
    await verifyBundle(directory, 'default-key');
  } finally { await removeTestDirectory(directory); }
});

async function runScript(directory) {
  const script = join(repository, 'scripts', 'create-adapter-registry-signing-key.mjs');
  const args = [script, '--backup-directory', directory, '--key-name', 'test-key'];
  const result = await execFileAsync(process.execPath, args, { cwd: repository, maxBuffer: 2_000_000 });
  return result.stdout;
}

async function runScriptWithDefault(directory) {
  const script = join(repository, 'scripts', 'create-adapter-registry-signing-key.mjs');
  const args = [script, '--key-name', 'default-key'];
  const env = { ...process.env };
  delete env.INIT_CWD;
  await execFileAsync(process.execPath, args, { cwd: directory, env, maxBuffer: 2_000_000 });
}

async function verifyBundle(directory, keyName = 'test-key') {
  const privatePem = await readFile(join(directory, `${keyName}.private.pem`), 'utf-8');
  const publicPem = await readFile(join(directory, `${keyName}.public.pem`), 'utf-8');
  const metadata = JSON.parse(await readFile(join(directory, `${keyName}.metadata.json`), 'utf-8'));
  assert.match(privatePem, /PRIVATE KEY/);
  assert.match(publicPem, /PUBLIC KEY/);
  assert.equal(metadata.keyId, keyName);
  assert.equal(metadata.githubSecretName, 'ADAPTER_REGISTRY_PRIVATE_KEY');
}

async function removeTestDirectory(directory) {
  const resolved = resolve(directory);
  assert.equal(dirname(resolved), resolve(tmpdir()));
  assert.match(resolved, /comiccrawler-registry-key-/);
  await rm(resolved, { recursive: true, force: true });
}
