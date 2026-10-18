import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import {
  BrowserClient,
  type BrowserCapabilities,
  type BrowserClientSocket,
  type BrowserClientState,
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserExecutor,
  type BrowserSession,
  type ClientStateStore,
} from '@comiccrawler/browser-client-sdk';
import WebSocket, { WebSocketServer } from 'ws';
import { BrowserClientRegistry } from '../../../src/browser/browser-client-registry';
import { BrowserSessionGateway } from '../../../src/browser/browser-session-gateway';
import type { ApiPrincipal } from '../../../src/security/api-security';

const capabilities: BrowserCapabilities = {
  executionMode: 'existing-tab',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

describe('BrowserSessionGateway', () => {
  let server: Server;
  let webSocketServer: WebSocketServer;
  let gateway: BrowserSessionGateway;
  let client: BrowserClient | undefined;

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    gateway?.dispose();
    webSocketServer?.close();
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('runs session commands through a real WebSocket and retains Worker identity on reconnect', async () => {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { name: 'Integration Client', capabilities });
    gateway = new BrowserSessionGateway(registry, undefined, {
      heartbeatIntervalMs: 10_000,
      heartbeatTimeoutMs: 30_000,
    });
    server = createServer();
    webSocketServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/api/browser-clients/connect') return socket.destroy();
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => gateway.acceptConnection(webSocket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no address.');
    const serverUrl = `http://127.0.0.1:${address.port}`;
    const executor = new TestExecutor();
    client = new BrowserClient({
      serverUrl,
      executor,
      stateStore: new MemoryStateStore({
        schemaVersion: 1,
        serverUrl: `${serverUrl}/`,
        clientId: enrollment.clientId,
        credentialId: enrollment.credentialId,
        credential: enrollment.credential,
        registeredAt: enrollment.registeredAt,
      }),
      fetch: async () => jsonResponse({
        protocolVersion: 2,
        apiSecurityMode: 'public',
        endpoints: {
          enroll: '/api/browser-clients/enroll',
          controlWebSocket: '/api/browser-clients/connect',
        },
      }),
      webSocketFactory: {
        create: (url) => new WebSocket(url) as unknown as BrowserClientSocket,
      },
      randomUUID: () => 'process-integration',
    });

    const firstConnection = await client.connect();
    expect(firstConnection.workerId).toMatch(/^bw_/);
    expect(gateway.listWorkers('alice')).toEqual([
      expect.objectContaining({
        workerId: firstConnection.workerId,
        clientId: enrollment.clientId,
        processInstanceId: 'process-integration',
        online: true,
      }),
    ]);

    const resource = await client.registerResource({
      kind: 'tab',
      url: 'https://example.test/chapter',
      title: 'Chapter',
    });
    expect(gateway.listResources('alice', firstConnection.workerId)).toEqual([
      expect.objectContaining({
        resourceId: resource.resourceId,
        workerId: firstConnection.workerId,
        url: 'https://example.test/chapter',
      }),
    ]);

    const session = await gateway.openSession({
      workerId: firstConnection.workerId,
      leaseId: 'lease-1',
      source: {
        type: 'existing-resource',
        resourceId: resource.resourceId,
        expectedUrl: 'https://example.test/chapter',
        navigationPolicy: 'adopt-current-page',
      },
    });
    expect(executor.openRequests).toEqual([
      expect.objectContaining({ sessionId: session.sessionId, leaseId: 'lease-1' }),
    ]);
    await expect(gateway.openSession({
      workerId: firstConnection.workerId,
      leaseId: 'lease-2',
      source: {
        type: 'existing-resource',
        resourceId: resource.resourceId,
        expectedUrl: 'https://example.test/chapter',
        navigationPolicy: 'adopt-current-page',
      },
    })).rejects.toThrow('is busy');

    await expect(gateway.execute(session.sessionId, {
      type: 'page.navigate',
      url: 'https://example.test/chapter',
    })).resolves.toEqual({
      type: 'page.navigate',
      url: 'https://example.test/chapter',
    });
    await expect(gateway.execute(session.sessionId, { type: 'page.get-content' })).resolves.toEqual({
      type: 'page.get-content',
      url: 'https://example.test/chapter',
      html: '<main>chapter</main>',
    });

    await expect(client.revokeResource(resource.resourceId)).rejects.toThrow('is in use');
    expect(gateway.getWorker(firstConnection.workerId)).toMatchObject({ online: true });
    expect(gateway.getResource(resource.resourceId)).toBeDefined();

    await gateway.closeSession(session.sessionId);
    expect(executor.session.closed).toBe(true);
    await expect(gateway.openSession({
      workerId: firstConnection.workerId,
      leaseId: 'lease-url-mismatch',
      source: {
        type: 'existing-resource',
        resourceId: resource.resourceId,
        expectedUrl: 'https://example.test/another-chapter',
        navigationPolicy: 'adopt-current-page',
      },
    })).rejects.toThrow('is not on the requested URL');
    await client.revokeResource(resource.resourceId);
    expect(gateway.getResource(resource.resourceId)).toBeUndefined();

    await client.disconnect();
    await waitFor(() => gateway.getWorker(firstConnection.workerId)?.online === false);
    const reconnected = await client.connect();
    expect(reconnected.workerId).toBe(firstConnection.workerId);
  });

  it('rejects an invalid client credential before registering a Worker', async () => {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { capabilities });
    gateway = new BrowserSessionGateway(registry);
    server = createServer();
    webSocketServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => gateway.acceptConnection(webSocket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no address.');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/browser-clients/connect`);
    await once(socket, 'open');
    socket.send(JSON.stringify({
      protocolVersion: 2,
      type: 'client.authenticate',
      clientId: enrollment.clientId,
      credential: 'invalid',
      processInstanceId: 'bad-process',
      capabilities,
    }));
    const [data] = await once(socket, 'message');
    expect(JSON.parse(data.toString())).toEqual({
      protocolVersion: 2,
      type: 'client.rejected',
      reason: 'Browser Client credential is invalid.',
    });
    await once(socket, 'close');
    expect(gateway.listWorkers()).toEqual([]);
  });

  it('rejects resource registration from a managed-profile Worker without disconnecting it', async () => {
    const managedCapabilities: BrowserCapabilities = {
      ...capabilities,
      executionMode: 'managed-profile',
    };
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { capabilities: managedCapabilities });
    gateway = new BrowserSessionGateway(registry);
    server = createServer();
    webSocketServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => gateway.acceptConnection(webSocket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no address.');
    const serverUrl = `http://127.0.0.1:${address.port}`;
    client = new BrowserClient({
      serverUrl,
      executor: new TestExecutor(managedCapabilities),
      stateStore: new MemoryStateStore({
        schemaVersion: 1,
        serverUrl: `${serverUrl}/`,
        clientId: enrollment.clientId,
        credentialId: enrollment.credentialId,
        credential: enrollment.credential,
        registeredAt: enrollment.registeredAt,
      }),
      fetch: async () => jsonResponse({
        protocolVersion: 2,
        apiSecurityMode: 'public',
        endpoints: {
          enroll: '/api/browser-clients/enroll',
          controlWebSocket: '/api/browser-clients/connect',
        },
      }),
      webSocketFactory: {
        create: (url) => new WebSocket(url) as unknown as BrowserClientSocket,
      },
    });

    const connection = await client.connect();
    await expect(client.registerResource({
      kind: 'tab',
      url: 'https://example.test/chapter',
    })).rejects.toThrow('Only an existing-tab Browser Worker');
    expect(gateway.getWorker(connection.workerId)).toMatchObject({ online: true });
    expect(gateway.listResources('alice')).toEqual([]);
  });
});

class MemoryStateStore implements ClientStateStore {
  constructor(private readonly state: BrowserClientState) {}
  async get(): Promise<BrowserClientState> {
    return this.state;
  }
  async set(): Promise<void> {}
  async clear(): Promise<void> {}
}

class TestExecutor implements BrowserExecutor {
  readonly session = new TestSession();
  readonly openRequests: Array<{ sessionId: string; leaseId: string }> = [];

  constructor(private readonly describedCapabilities: BrowserCapabilities = capabilities) {}

  async describe(): Promise<BrowserCapabilities> {
    return this.describedCapabilities;
  }
  async openSession(request: { sessionId: string; leaseId: string }): Promise<BrowserSession> {
    this.openRequests.push(request);
    return this.session;
  }
  async close(): Promise<void> {}
}

class TestSession implements BrowserSession {
  closed = false;
  private url = 'about:blank';

  async execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    if (command.type === 'page.navigate') {
      this.url = command.url;
      return { type: command.type, url: this.url };
    }
    if (command.type === 'page.get-content') {
      return { type: command.type, url: this.url, html: '<main>chapter</main>' };
    }
    if (command.type === 'page.focus') return { type: command.type };
    return { type: command.type, url: this.url };
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function principal(): ApiPrincipal {
  return {
    userId: 'alice',
    roles: ['user'],
    permissions: new Set(['browser-client:register', 'browser-client:session-own']),
    limits: {},
    public: false,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out while waiting for test condition.');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
