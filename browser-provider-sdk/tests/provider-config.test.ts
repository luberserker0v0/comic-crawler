import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadProviderState, readCredential, writeEnrollmentFiles } from '../src';

test('enrollment writes independently configurable state and credential outputs', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-provider-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateOutput = join(root, 'state', 'client.json');
  const credentialOutput = join(root, 'secret', 'client.credential');

  const paths = await writeEnrollmentFiles({
    enrollment: {
      providerId: 'bp_server_assigned',
      credentialId: 'cred_server_assigned',
      credential: 'ccbp_secret',
      enrolledAt: '2026-10-14T00:00:00.000Z',
    },
    serverUrl: 'https://crawler.example',
    stateOutput,
    credentialOutput,
  });

  assert.equal(paths.statePath, stateOutput);
  assert.equal(paths.credentialPath, credentialOutput);
  assert.equal(await readCredential(credentialOutput), 'ccbp_secret');
  assert.deepEqual(await loadProviderState(stateOutput), {
    schemaVersion: 1,
    providerId: 'bp_server_assigned',
    serverUrl: 'https://crawler.example',
    credential: {
      type: 'device-token',
      credentialId: 'cred_server_assigned',
      file: credentialOutput.replace(/\\/g, '/'),
    },
    enrolledAt: '2026-10-14T00:00:00.000Z',
  });
});

test('enrollment does not overwrite existing credential output', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-provider-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const credentialOutput = join(root, 'provider.credential');
  await fs.writeFile(credentialOutput, 'existing\n');

  await assert.rejects(() => writeEnrollmentFiles({
    enrollment: {
      providerId: 'bp_new',
      credentialId: 'cred_new',
      credential: 'ccbp_new',
      enrolledAt: '2026-10-14T00:00:00.000Z',
    },
    serverUrl: 'https://crawler.example',
    stateOutput: join(root, 'state.json'),
    credentialOutput,
  }), /EEXIST/);
  assert.equal(await fs.readFile(credentialOutput, 'utf8'), 'existing\n');
});
