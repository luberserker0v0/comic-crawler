import { afterEach, describe, expect, it } from '@jest/globals';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { listSelectorDiscoveryAoProvidersByUrl } from '../../../src/selector-discovery/preflight';

let server: Server | undefined;

const seen: string[] = [];

async function startFakeAoServer(
    handler: (request: IncomingMessage, body: string) => Promise<{ status: number; body: unknown }>
  ): Promise<string> {
    server = createServer((request, response) => {
      void serveFakeRequest(request, response, handler);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

async function serveFakeRequest(request: IncomingMessage, response: import('node:http').ServerResponse,
  handler: (request: IncomingMessage, body: string) => Promise<{ status: number; body: unknown }>) {
  let body = '';
  for await (const chunk of request) body += chunk.toString();
  const result = await handler(request, body);
  response.statusCode = result.status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(result.body));
}

describe('listSelectorDiscoveryAoProvidersByUrl', () => {
  listSelectorDiscoveryAoProvidersByUrlTestGroup1();
});

function listSelectorDiscoveryAoProvidersByUrlTestGroup1(): void {
  afterEach(listSelectorDiscoveryAoProvidersByUrlTestScenario1);
  it('lists AO providers from a bare URL without saved settings or bundle upload', listSelectorDiscoveryAoProvidersByUrlTestListsAOProvidersFromABareURLWithoutSavedSettingsOrBundleUpload);
  it('requires an AO URL', listSelectorDiscoveryAoProvidersByUrlTestRequiresAnAOURL);
}

async function listSelectorDiscoveryAoProvidersByUrlTestScenario1() {
    seen.length = 0;
    if (!server)
        return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
}

async function listSelectorDiscoveryAoProvidersByUrlTestListsAOProvidersFromABareURLWithoutSavedSettingsOrBundleUpload() {
    const baseUrl = await startFakeAoServer(fakeAoHandler);
    const result = await listSelectorDiscoveryAoProvidersByUrl({ aoBaseUrl: baseUrl });
    expect(result.models).toEqual([
        expect.objectContaining({ id: 'demo-provider/demo-model', providerId: 'demo-provider' }),
    ]);
    expect(result.providers).toEqual([
        expect.objectContaining({ id: 'demo-provider', modelCount: 1 }),
    ]);
    // No bundle upload and no session/message calls on the URL-only path.
    expect(seen.some((entry) => entry.includes('/config') || entry.includes('/skills/') || entry.includes('/message'))).toBe(false);
    expect(seen).toContain('DELETE /api/conversations/conv-url-only');
}

async function fakeAoHandler(request: IncomingMessage) {
  seen.push(`${request.method} ${request.url}`);
  if (request.method === 'POST' && request.url === '/api/conversations')
    return { status: 200, body: { id: 'conv-url-only' } };
  if (request.url === '/api/conversations/conv-url-only/start' || request.url === '/api/conversations/conv-url-only')
    return { status: 200, body: { id: 'conv-url-only', ready: true, sessionId: 'session-1' } };
  if (request.url === '/api/conversations/conv-url-only/providers')
    return { status: 200, body: AO_PROVIDERS_RESPONSE };
  if (request.method === 'DELETE' && request.url === '/api/conversations/conv-url-only')
    return { status: 200, body: {} };
  return { status: 404, body: { error: 'not found' } };
}

const AO_PROVIDERS_RESPONSE = { providers: [{ id: 'demo-provider', models: {
  'demo-model': { id: 'demo-model', name: 'Demo Model', status: 'active' },
} }] };

async function listSelectorDiscoveryAoProvidersByUrlTestRequiresAnAOURL() {
    await expect(listSelectorDiscoveryAoProvidersByUrl({ aoBaseUrl: '   ' })).rejects.toThrow(/AO URL is required/);
}
