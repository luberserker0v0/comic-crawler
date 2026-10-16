import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadProviderState, readCredential, writeProviderFiles } from '../src';

test('registration writes independently configurable state and credential outputs', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-provider-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateOutput = join(root, 'state', 'client.json');
  const credentialOutput = join(root, 'secret', 'client.credential');

  const paths = await writeProviderFiles({
    registration: {
      providerId: 'bp_server_assigned',
      clientInstanceId: 'client-instance-1',
      credentialId: 'cred_server_assigned',
      credential: 'ccbp_secret',
      registeredAt: '2026-10-14T00:00:00.000Z',
    },
    serverUrl: 'https://crawler.example',
    stateOutput,
    credentialOutput,
  });

  assert.equal(paths.statePath, stateOutput);
  assert.equal(paths.credentialPath, credentialOutput);
  assert.equal(await readCredential(credentialOutput), 'ccbp_secret');
  assert.deepEqual(await loadProviderState(stateOutput), {
    schemaVersion: 2,
    providerId: 'bp_server_assigned',
    clientInstanceId: 'client-instance-1',
    serverUrl: 'https://crawler.example',
    credential: {
      type: 'provider-token',
      credentialId: 'cred_server_assigned',
      file: credentialOutput.replace(/\\/g, '/'),
    },
    registeredAt: '2026-10-14T00:00:00.000Z',
  });
});

test('registration does not overwrite existing credential output', async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'comiccrawler-provider-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const credentialOutput = join(root, 'provider.credential');
  await fs.writeFile(credentialOutput, 'existing\n');

  await assert.rejects(() => writeProviderFiles({
    registration: {
      providerId: 'bp_new',
      clientInstanceId: 'client-instance-2',
      credentialId: 'cred_new',
      credential: 'ccbp_new',
      registeredAt: '2026-10-14T00:00:00.000Z',
    },
    serverUrl: 'https://crawler.example',
    stateOutput: join(root, 'state.json'),
    credentialOutput,
  }), /EEXIST/);
  assert.equal(await fs.readFile(credentialOutput, 'utf8'), 'existing\n');
});
