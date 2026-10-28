import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
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

let server: Server;

let webSocketServer: WebSocketServer;

let gateway: BrowserSessionGateway;

let client: BrowserClient | undefined;

describe('BrowserSessionGateway', () => {
  BrowserSessionGatewayTestGroup1();
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
  private resolveTermination!: () => void;
  readonly terminated = new Promise<void>((resolve) => { this.resolveTermination = resolve; });
  private url = 'about:blank';
  private blockNext = false;
  private blockedStarted?: () => void;

  async execute(command: BrowserCommand, signal?: AbortSignal): Promise<BrowserCommandResult> {
    if (this.blockNext) return this.executeBlocked(signal);
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
  terminate(): void {
    this.resolveTermination();
  }
  waitForBlockedCommand(): Promise<void> {
    this.blockNext = true;
    return new Promise((resolve) => { this.blockedStarted = resolve; });
  }
  private executeBlocked(signal?: AbortSignal): Promise<BrowserCommandResult> {
    this.blockNext = false;
    this.blockedStarted?.();
    return new Promise((_resolve, reject) => signal?.addEventListener(
      'abort', () => reject(signal.reason), { once: true }));
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

function BrowserSessionGatewayTestGroup1(): void {
  afterEach(BrowserSessionGatewayTestScenario1);
  it('runs session commands through a real WebSocket and retains Worker identity on reconnect', BrowserSessionGatewayTestRunsSessionCommandsThroughARealWebSocketAndRetainsWorkerIdentityOnReconnect);
  it('rejects an invalid client credential before registering a Worker', BrowserSessionGatewayTestRejectsAnInvalidClientCredentialBeforeRegisteringAWorker);
  it('rejects resource registration from a managed-profile Worker without disconnecting it', BrowserSessionGatewayTestRejectsResourceRegistrationFromAManagedProfileWorkerWithoutDisconnectingIt);
  it('clears a session closed locally while keeping its Worker online', BrowserSessionGatewayTestClearsLocallyClosedSession);
}

async function BrowserSessionGatewayTestScenario1() {
    await client?.close().catch(() => undefined);
    gateway?.dispose();
    webSocketServer?.close();
    if (server?.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function BrowserSessionGatewayTestRunsSessionCommandsThroughARealWebSocketAndRetainsWorkerIdentityOnReconnect() {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { name: 'Integration Client', capabilities });
    const serverUrl = await startGateway(registry, { heartbeatIntervalMs: 10000, heartbeatTimeoutMs: 30000 }, true);
    const executor = new TestExecutor();
    client = createTestClient(serverUrl, enrollment, executor, 'process-integration');
    const firstConnection = await client.connect();
    expectConnectedWorker(firstConnection.workerId, enrollment.clientId);
    const resource = await client.registerResource({ kind: 'tab',
      url: 'https://example.test/chapter', title: 'Chapter' });
    expectRegisteredResource(firstConnection.workerId, resource.resourceId);
    const session = await openResourceSession(firstConnection.workerId, resource.resourceId, 'lease-1');
    await expectSessionBehavior(executor, firstConnection.workerId, resource.resourceId, session.sessionId);
    await expectWorkerReconnect(firstConnection.workerId);
}

async function startGateway(registry: BrowserClientRegistry,
  options: NonNullable<ConstructorParameters<typeof BrowserSessionGateway>[2]> = {}, filterPath = false): Promise<string> {
    gateway = new BrowserSessionGateway(registry, undefined, options);
    server = createServer();
    webSocketServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
        if (filterPath && request.url !== '/api/browser-clients/connect')
            return socket.destroy();
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => gateway.acceptConnection(webSocket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Test server has no address.');
    return `http://127.0.0.1:${address.port}`;
}

type Enrollment = Awaited<ReturnType<BrowserClientRegistry['enroll']>>;

function createTestClient(serverUrl: string, enrollment: Enrollment, executor: BrowserExecutor,
  processInstanceId?: string): BrowserClient {
  return new BrowserClient({
        serverUrl,
        executor,
        stateStore: new MemoryStateStore(clientState(serverUrl, enrollment)),
        fetch: async () => jsonResponse(DISCOVERY_RESPONSE),
        webSocketFactory: {
            create: (url) => new WebSocket(url) as unknown as BrowserClientSocket,
        },
        ...(processInstanceId ? { randomUUID: () => processInstanceId } : {}),
    });
}

function clientState(serverUrl: string, enrollment: Enrollment): BrowserClientState {
  return { schemaVersion: 1, serverUrl: `${serverUrl}/`, clientId: enrollment.clientId,
    credentialId: enrollment.credentialId, credential: enrollment.credential,
    registeredAt: enrollment.registeredAt };
}

const DISCOVERY_RESPONSE = { protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION, apiSecurityMode: 'public' as const,
  endpoints: { enroll: '/api/browser-clients/enroll',
    controlWebSocket: '/api/browser-clients/connect' } };

function expectConnectedWorker(workerId: string, clientId: string): void {
    expect(workerId).toMatch(/^bw_/);
    expect(gateway.listWorkers('alice')).toEqual([
        expect.objectContaining({
            workerId, clientId,
            processInstanceId: 'process-integration',
            online: true,
        }),
    ]);
}

function expectRegisteredResource(workerId: string, resourceId: string): void {
    expect(gateway.listResources('alice', workerId)).toEqual([
        expect.objectContaining({
            resourceId, workerId,
            url: 'https://example.test/chapter',
        }),
    ]);
}

function openResourceSession(workerId: string, resourceId: string, leaseId: string) {
  return gateway.openSession({ workerId, leaseId,
        source: {
            type: 'existing-resource',
            resourceId,
            expectedUrl: 'https://example.test/chapter',
            navigationPolicy: 'adopt-current-page',
        },
  });
}

async function expectSessionBehavior(executor: TestExecutor, workerId: string,
  resourceId: string, sessionId: string): Promise<void> {
    expect(executor.openRequests).toEqual([
        expect.objectContaining({ sessionId, leaseId: 'lease-1' }),
    ]);
    await expect(openResourceSession(workerId, resourceId, 'lease-2')).rejects.toThrow('is busy');
    await expectSessionCommands(sessionId);
    await expectCommandCancellation(executor.session, sessionId);
    await expectCommandTimeoutCancellation(executor.session, sessionId);
    await expect(client!.revokeResource(resourceId)).rejects.toThrow('is in use');
    expect(gateway.getWorker(workerId)).toMatchObject({ online: true });
    await gateway.closeSession(sessionId);
    expect(executor.session.closed).toBe(true);
    await expectUrlMismatch(workerId, resourceId);
    await client!.revokeResource(resourceId);
}

async function expectSessionCommands(sessionId: string): Promise<void> {
    await expect(gateway.execute(sessionId, {
        type: 'page.navigate',
        url: 'https://example.test/chapter',
    })).resolves.toEqual({
        type: 'page.navigate',
        url: 'https://example.test/chapter',
    });
    await expect(gateway.execute(sessionId, { type: 'page.get-content' })).resolves.toEqual({
        type: 'page.get-content',
        url: 'https://example.test/chapter',
        html: '<main>chapter</main>',
    });
}

async function expectCommandCancellation(session: TestSession, sessionId: string): Promise<void> {
  const started = session.waitForBlockedCommand();
  const controller = new AbortController();
  const command = gateway.execute(sessionId, { type: 'page.get-content' }, 1_000, controller.signal);
  await started;
  controller.abort(new Error('Task cancelled.'));
  await expect(command).rejects.toMatchObject({ name: 'CANCELLED' });
  await expect(gateway.execute(sessionId, { type: 'page.get-url' })).resolves.toMatchObject({
    type: 'page.get-url', url: 'https://example.test/chapter',
  });
}

async function expectCommandTimeoutCancellation(session: TestSession, sessionId: string): Promise<void> {
  const started = session.waitForBlockedCommand();
  const command = gateway.execute(sessionId, { type: 'page.get-content' }, 20);
  await started;
  await expect(command).rejects.toThrow('timed out');
  await expect(gateway.execute(sessionId, { type: 'page.get-url' })).resolves.toMatchObject({
    type: 'page.get-url', url: 'https://example.test/chapter',
  });
}

async function expectUrlMismatch(workerId: string, resourceId: string): Promise<void> {
    await expect(gateway.openSession({ workerId, leaseId: 'lease-url-mismatch', source: {
      type: 'existing-resource', resourceId, expectedUrl: 'https://example.test/another-chapter',
      navigationPolicy: 'adopt-current-page' } })).rejects.toThrow('is not on the requested URL');
}

async function expectWorkerReconnect(workerId: string): Promise<void> {
  await client!.disconnect();
  await waitFor(() => gateway.getWorker(workerId)?.online === false);
  await expect(client!.connect()).resolves.toMatchObject({ workerId });
}

async function BrowserSessionGatewayTestRejectsAnInvalidClientCredentialBeforeRegisteringAWorker() {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { capabilities });
    const serverUrl = await startGateway(registry);
    const socket = new WebSocket(`${serverUrl.replace('http:', 'ws:')}/api/browser-clients/connect`);
    await once(socket, 'open');
    sendInvalidAuthentication(socket, enrollment.clientId);
    const [data] = await once(socket, 'message');
    expect(JSON.parse(data.toString())).toEqual({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'client.rejected',
        reason: 'Browser Client credential is invalid.',
    });
    await once(socket, 'close');
    expect(gateway.listWorkers()).toEqual([]);
}

function sendInvalidAuthentication(socket: WebSocket, clientId: string): void {
  socket.send(JSON.stringify({ protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION, type: 'client.authenticate', clientId,
    credential: 'invalid', processInstanceId: 'bad-process', capabilities }));
}

async function BrowserSessionGatewayTestRejectsResourceRegistrationFromAManagedProfileWorkerWithoutDisconnectingIt() {
    const managedCapabilities: BrowserCapabilities = {
        ...capabilities,
        executionMode: 'managed-profile',
    };
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { capabilities: managedCapabilities });
    const serverUrl = await startGateway(registry);
    client = createTestClient(serverUrl, enrollment, new TestExecutor(managedCapabilities));
    const connection = await client.connect();
    await expect(client.registerResource({
        kind: 'tab',
        url: 'https://example.test/chapter',
    })).rejects.toThrow('Only an existing-tab Browser Worker');
    expect(gateway.getWorker(connection.workerId)).toMatchObject({ online: true });
    expect(gateway.listResources('alice')).toEqual([]);
}

async function BrowserSessionGatewayTestClearsLocallyClosedSession() {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { name: 'Closing Client', capabilities });
    const serverUrl = await startGateway(registry);
    const executor = new TestExecutor();
    client = createTestClient(serverUrl, enrollment, executor, 'process-closing');
    const connection = await client.connect();
    const resource = await client.registerResource({ kind: 'tab', url: 'https://example.test/chapter' });
    const session = await openResourceSession(connection.workerId, resource.resourceId, 'lease-closing');
    executor.session.terminate();
    await waitFor(() => gateway.getWorker(connection.workerId)?.activeSessionId === undefined);
    expect(gateway.getWorker(connection.workerId)).toMatchObject({ online: true });
    await expect(gateway.execute(session.sessionId, { type: 'page.get-url' })).rejects.toThrow('is not active');
}
