import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { discoverBrowserProviderService, registerBrowserProvider } from '../src';

test('registers a provider with user authentication discovered from contract v2', async (context) => {
  const requests: Array<{ url?: string; authorization?: string; userId?: string; body: string }> = [];
  const server = createServer((request, response) => {
    if (request.url === '/.well-known/comiccrawler-browser-provider') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: {
        contractVersion: '2',
        transport: 'reverse-relay',
        apiSecurityMode: 'token',
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      } }));
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        userId: request.headers['x-comiccrawler-user-id'] as string | undefined,
        body,
      });
      response.statusCode = 201;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: {
        providerId: 'bp_test',
        clientInstanceId: 'client-test',
        credentialId: 'cred_test',
        credential: 'ccbp_test',
        registeredAt: '2026-10-15T00:00:00.000Z',
      } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no address.');
  const serverUrl = `http://127.0.0.1:${address.port}`;

  const discovery = await discoverBrowserProviderService(serverUrl);
  assert.equal(discovery.apiSecurityMode, 'token');
  await assert.rejects(() => registerBrowserProvider({
    serverUrl,
    registration: { clientInstanceId: 'client-test' },
  }), /requires a user ID and user API token/);
  assert.equal(requests.length, 0);
  const registration = await registerBrowserProvider({
    serverUrl,
    registration: { clientInstanceId: 'client-test', providerName: 'Test Provider' },
    userId: 'alice',
    userToken: 'alice-secret',
  });

  assert.equal(registration.providerId, 'bp_test');
  assert.deepEqual(requests, [{
    url: '/api/browser-providers/enroll',
    authorization: 'Bearer alice-secret',
    userId: 'alice',
    body: JSON.stringify({ clientInstanceId: 'client-test', providerName: 'Test Provider' }),
  }]);
});

test('rejects an unsupported browser provider contract version', async (context) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: {
      contractVersion: '1',
      transport: 'reverse-relay',
      endpoints: {},
    } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no address.');

  await assert.rejects(
    () => discoverBrowserProviderService(`http://127.0.0.1:${address.port}`),
    /unsupported browser provider contract/
  );
});
