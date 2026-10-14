import { afterEach, describe, expect, it } from '@jest/globals';
import fastify, { type FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import {
  ReverseRelayBrowserProviderClient,
  type BrowserProvider,
  type BrowserProviderCapabilities,
  type BrowserProviderDescriptor,
  type BrowserProviderSessionHandle,
} from '@comiccrawler/browser-provider-sdk';
import { BrowserProviderRegistry } from '../../../src/browser/provider-registry';
import { EventBus } from '../../../src/events/bus';
import { setupBrowserProviderRoutes } from '../../../src/server/routes/browser-providers';
import { setupWebSocket } from '../../../src/server/websocket';

describe('browser provider routes', () => {
  let app: FastifyInstance | undefined;
  let httpServer: Server | undefined;
  let echoServer: WebSocketServer | undefined;

  afterEach(async () => {
    await app?.close();
    if (httpServer?.listening) await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    if (echoServer) await new Promise<void>((resolve) => echoServer?.close(() => resolve()));
  });

  it('enrolls a provider with a one-time token and assigns its identity on the server', async () => {
    const registry = new BrowserProviderRegistry();
    app = fastify();
    setupBrowserProviderRoutes(app, registry);

    const discovery = await app.inject({ method: 'GET', url: '/.well-known/comiccrawler-browser-provider' });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json().data).toMatchObject({
      contractVersion: '1',
      transport: 'reverse-relay',
      endpoints: { controlWebSocket: '/api/browser-providers/connect' },
    });

    const tokenResponse = await app.inject({
      method: 'POST',
      url: '/api/browser-providers/enrollment-tokens',
      payload: { ttlSeconds: 300 },
    });
    expect(tokenResponse.statusCode).toBe(201);
    const token = tokenResponse.json().data.token as string;

    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/browser-providers/enroll',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.json().data).toMatchObject({
      providerId: expect.stringMatching(/^bp_/),
      credentialId: expect.stringMatching(/^cred_/),
      credential: expect.stringMatching(/^ccbp_/),
    });

    const reused = await app.inject({
      method: 'POST',
      url: '/api/browser-providers/enroll',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reused.statusCode).toBe(401);

    const listed = await app.inject({ method: 'GET', url: '/api/browser-providers' });
    expect(listed.json().data.providers).toEqual([
      expect.objectContaining({
        providerId: enrolled.json().data.providerId,
        online: false,
      }),
    ]);

    const created = await app.inject({
      method: 'POST',
      url: `/api/browser-providers/${enrolled.json().data.providerId}/sessions`,
      payload: { requestedCapabilities: { interactive: true } },
    });
    expect(created.statusCode).toBe(400);
    expect(created.json().error).toContain('offline');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/browser-providers/${enrolled.json().data.providerId}`,
    });
    expect(removed.statusCode).toBe(204);
    expect(registry.list()).toEqual([]);
  });

  it('requires a Bearer enrollment token', async () => {
    app = fastify();
    setupBrowserProviderRoutes(app, new BrowserProviderRegistry());
    const response = await app.inject({ method: 'POST', url: '/api/browser-providers/enroll' });
    expect(response.statusCode).toBe(401);
  });

  it('creates sessions through the outbound provider control connection', async () => {
    const registry = new BrowserProviderRegistry();
    const token = registry.createEnrollmentToken().token;
    const enrollment = await registry.enroll(token);
    httpServer = createServer((request, response) => {
      if (request.url !== '/.well-known/comiccrawler-browser-provider') return response.writeHead(404).end();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: {
        contractVersion: '1',
        transport: 'reverse-relay',
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      } }));
    });
    setupWebSocket(httpServer, new EventBus(), registry);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
    registry.setRelayBaseUrl(`http://127.0.0.1:${address.port}`);

    const control = new WebSocket(`ws://127.0.0.1:${address.port}/api/browser-providers/connect`, {
      headers: { authorization: `Bearer ${enrollment.credential}` },
    });
    await once(control, 'open');
    control.send(JSON.stringify({ type: 'hello', descriptor: descriptor(enrollment.providerId) }));
    await waitUntil(() => registry.list()[0]?.online === true && Boolean(registry.list()[0]?.descriptor));
    control.on('message', (data) => {
      const request = JSON.parse(data.toString()) as { type: string; requestId: string };
      if (request.type !== 'create-session') return;
      control.send(JSON.stringify({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        data: session(enrollment.providerId),
      }));
    });

    const created = await registry.createSession(enrollment.providerId, { ttlSeconds: 60 });
    expect(created).toMatchObject({
      providerId: enrollment.providerId,
      transport: 'reverse-relay',
    });
    expect(created.connectUrl).toMatch(new RegExp(`^ws://127\\.0\\.0\\.1:${address.port}/api/browser-providers/sessions/`));
    control.close();
    registry.dispose();
  });

  it('relays browser WebSocket traffic through outbound provider tunnels', async () => {
    echoServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(echoServer, 'listening');
    const echoAddress = echoServer.address();
    if (!echoAddress || typeof echoAddress === 'string') throw new Error('Echo server has no TCP address.');
    echoServer.on('connection', (socket) => socket.on('message', (data, binary) => socket.send(data, { binary })));

    const registry = new BrowserProviderRegistry();
    const enrollment = await registry.enroll(registry.createEnrollmentToken().token);
    httpServer = createServer((request, response) => {
      if (request.url !== '/.well-known/comiccrawler-browser-provider') return response.writeHead(404).end();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: {
        contractVersion: '1',
        transport: 'reverse-relay',
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      } }));
    });
    setupWebSocket(httpServer, new EventBus(), registry);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Relay server has no TCP address.');
    const serverUrl = `http://127.0.0.1:${address.port}`;
    registry.setRelayBaseUrl(serverUrl);

    const provider = fakeProvider(enrollment.providerId, `ws://127.0.0.1:${echoAddress.port}`);
    const client = new ReverseRelayBrowserProviderClient({ serverUrl, credential: enrollment.credential, provider });
    const connected = client.connectOnce();
    await waitUntil(() => Boolean(registry.list()[0]?.descriptor));
    const session = await registry.createSession(enrollment.providerId);

    const browser = new WebSocket(session.connectUrl);
    const localConnection = once(echoServer, 'connection');
    await once(browser, 'open');
    const echoed = once(browser, 'message');
    browser.send('relay-ok');
    await localConnection;
    const [payload] = await echoed;
    expect(payload.toString()).toBe('relay-ok');

    browser.close();
    await client.close();
    await connected;
    registry.dispose();
  });
});

function fakeProvider(providerId: string, localWsEndpoint: string): BrowserProvider {
  const handle: BrowserProviderSessionHandle = {
    ...session(providerId),
    localWsEndpoint,
  };
  return {
    describe: async () => descriptor(providerId),
    createSession: async () => handle,
    getSession: async (sessionId) => sessionId === handle.sessionId ? handle : undefined,
    heartbeat: async () => handle,
    closeSession: async () => undefined,
    close: async () => undefined,
  };
}

function descriptor(providerId: string): BrowserProviderDescriptor {
  return {
    contractVersion: '1',
    providerId,
    providerType: 'playwright',
    runtimeVersion: '1.64.0',
    capabilities: capabilities(),
    transports: ['reverse-relay'],
  };
}

function session(providerId: string): Omit<BrowserProviderSessionHandle, 'localWsEndpoint'> {
  const now = Date.now();
  return {
    sessionId: 'session-1',
    providerId,
    protocol: 'playwright',
    transport: 'reverse-relay',
    runtimeVersion: '1.64.0',
    capabilities: capabilities(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function capabilities(): BrowserProviderCapabilities {
  return {
    browser: 'chromium',
    headed: true,
    interactive: true,
    persistentContext: false,
    screenshots: true,
    downloads: true,
    tracing: true,
    fileTransfer: false,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for provider handshake.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
