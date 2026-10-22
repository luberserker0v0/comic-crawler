import fastify from 'fastify';
import { setupAdapterRegistryRoutes } from '../../../src/server/routes/adapter-registry';
import type { OfficialAdapterRegistryService } from '../../../src/adapter/official-registry';

describe('adapter registry routes', () => {
  it('lists verified packages', listsPackages);
  it('installs inactive by default', installsInactive);
  it('rejects install without adapterId', rejectsMissingAdapterId);
});

async function listsPackages() {
  const { app, calls } = createApp();
  const response = await app.inject({ method: 'GET', url: '/api/adapter-registry/packages' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ data: [] });
  expect(calls).toContain('list');
}

async function installsInactive() {
  const { app, installs } = createApp();
  const response = await app.inject({ method: 'POST', url: '/api/adapter-registry/install',
    payload: { registryId: 'official', adapterId: 'demo' } });
  expect(response.statusCode).toBe(200);
  expect(installs[0]).toEqual({ registryId: 'official', adapterId: 'demo' });
}

async function rejectsMissingAdapterId() {
  const { app } = createApp();
  const response = await app.inject({ method: 'POST', url: '/api/adapter-registry/install', payload: {} });
  expect(response.statusCode).toBe(400);
}

function createApp() {
  const app = fastify();
  const calls: string[] = [];
  const installs: unknown[] = [];
  const service = { list: async () => { calls.push('list'); return []; },
    check: async () => [], update: async () => [], install: async (input: unknown) => {
      installs.push(input); return updateResult(); } } as unknown as OfficialAdapterRegistryService;
  setupAdapterRegistryRoutes(app, service);
  return { app, calls, installs };
}

function updateResult() {
  return { registryId: 'official', installed: true, active: false,
    package: { adapterId: 'demo', version: 'v1', packageUrl: 'https://registry.test/demo.json',
      publishedAt: '2026-10-22T00:00:00.000Z', manifestChecksum: 'a'.repeat(64),
      implementationChecksum: 'b'.repeat(64), keyId: 'release-2026' } };
}
