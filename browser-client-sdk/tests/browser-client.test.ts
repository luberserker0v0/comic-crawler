import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
  BrowserClient,
  type BrowserCapabilities,
  type BrowserClientSocket,
  type BrowserClientSocketCloseEvent,
  type BrowserClientSocketMessageEvent,
  type BrowserClientState,
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserExecutor,
  type BrowserSession,
  type ClientStateStore,
} from '../src';

const capabilities: BrowserCapabilities = {
  executionMode: 'managed-profile',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

test('enrolls with user credentials and saves the returned client credential', testEnrollment);
test('authenticates, binds commands to the active lease, and executes them sequentially', testSequentialCommands);
test('rejects a connection when saved state belongs to another server', testWrongServer);
test('registers and revokes an opaque browser resource over the control WebSocket', testResourceLifecycle);
test('keeps the active browser session when the same process reconnects', testSessionReconnect);
test('re-registers process-memory browser resources after reconnect', testResourceReconnect);

async function testEnrollment(): Promise<void> {
  const stateStore = new MemoryStateStore();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = new BrowserClient({
    serverUrl: 'https://crawler.example',
    executor: new TestExecutor(),
    stateStore,
    fetch: createEnrollmentFetch(requests),
  });
  const state = await client.enroll(enrollmentOptions());
  assertEnrollmentRequest(requests);
  assert.deepEqual(stateStore.state, state);
  assert.equal(state.credential, 'secret-1');
}

function createEnrollmentFetch(requests: Array<{ url: string; init?: RequestInit }>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith('/.well-known/comiccrawler-browser-client')) return tokenDiscoveryResponse();
    return jsonResponse({
      clientId: 'client-1',
      credentialId: 'credential-1',
      credential: 'secret-1',
      registeredAt: '2026-10-16T00:00:00.000Z',
    }, 201);
  };
}

function tokenDiscoveryResponse(): Response {
  return jsonResponse({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    apiSecurityMode: 'token',
    endpoints: { enroll: '/api/browser-clients/enroll', controlWebSocket: '/api/browser-clients/connect' },
  });
}

function enrollmentOptions() {
  return { name: 'Alice Chrome', credentials: { userId: 'alice', userToken: 'user-secret' } };
}

function assertEnrollmentRequest(requests: Array<{ url: string; init?: RequestInit }>): void {
  assert.equal(requests.length, 2);
  const enrollment = requests[1];
  assert.equal(enrollment.url, 'https://crawler.example/api/browser-clients/enroll');
  assert.deepEqual(enrollment.init?.headers, {
    'content-type': 'application/json',
    'x-comiccrawler-user-id': 'alice',
    authorization: 'Bearer user-secret',
  });
  assert.deepEqual(JSON.parse(String(enrollment.init?.body)), {
    name: 'Alice Chrome',
    capabilities,
  });
}

async function testSequentialCommands(): Promise<void> {
  const socket = new FakeSocket();
  const session = new ControlledSession();
  const executor = new TestExecutor(session);
  const client = createClient(() => socket, executor);
  await connectClient(client, socket);
  await openRemoteSession(socket);
  await verifySequentialExecution(socket, session);
  await verifyLeaseMismatch(socket);
  await closeRemoteSession(socket, session);
  await client.close();
  assert.equal(executor.closed, true);
}

async function verifySequentialExecution(socket: FakeSocket, session: ControlledSession): Promise<void> {
  socket.serverSend(commandMessage('request-1', 'page.get-url'));
  socket.serverSend(commandMessage('request-2', 'page.get-content'));
  await waitFor(() => session.started.length === 1);
  assert.equal(session.maxConcurrent, 1);
  session.releaseNext({ type: 'page.get-url', url: 'https://example.test/chapter' });
  await waitFor(() => session.started.length === 2);
  assert.equal(session.maxConcurrent, 1);
  session.releaseNext({
    type: 'page.get-content',
    url: 'https://example.test/chapter',
    html: '<main>chapter</main>',
  });
  await waitFor(() => socket.jsonMessages().filter((message) => message.type === 'command.result').length === 2);

  const results = socket.jsonMessages().filter((message) => message.type === 'command.result');
  assert.deepEqual(results.map((message) => message.requestId), ['request-1', 'request-2']);
  assert.equal(session.maxConcurrent, 1);
}

async function verifyLeaseMismatch(socket: FakeSocket): Promise<void> {
  socket.serverSend({
    ...commandMessage('request-3', 'page.get-url'),
    leaseId: 'wrong-lease',
  });
  await waitFor(() => socket.jsonMessages().some((message) => message.requestId === 'request-3'));
  const mismatch = socket.jsonMessages().find((message) => message.requestId === 'request-3');
  assert.deepEqual(mismatch, {
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.result',
    requestId: 'request-3',
    ok: false,
    error: {
      code: 'LEASE_MISMATCH',
      message: 'Command does not match the active lease and session.',
      retryable: false,
    },
  });
}

async function closeRemoteSession(socket: FakeSocket, session: ControlledSession): Promise<void> {
  socket.serverSend({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'session.close',
    sessionId: 'session-1',
    leaseId: 'lease-1',
  });
  await waitForMessage(socket, 'session.closed');
  assert.equal(session.closed, true);
}

async function testWrongServer(): Promise<void> {
  const client = new BrowserClient({
    serverUrl: 'https://crawler.example',
    executor: new TestExecutor(),
    stateStore: new MemoryStateStore(enrolledState('https://other.example/')),
    fetch: discoveryFetch,
  });
  await assert.rejects(() => client.connect(), /belongs to a different server/);
}

async function testResourceLifecycle(): Promise<void> {
  const socket = new FakeSocket();
  const client = createClient(() => socket, new TestExecutor(), () => 'fixed-id');
  await connectClient(client, socket, 'fixed-id');
  const resource = await registerTestResource(client, socket);
  assert.equal(resource.resourceId, 'brr_fixed-id');
  await revokeTestResource(client, socket, resource.resourceId);
  await client.close();
}

async function testSessionReconnect(): Promise<void> {
  const first = new FakeSocket();
  const second = new FakeSocket();
  const sockets = [first, second];
  const session = new ControlledSession();
  const executor = new TestExecutor(session);
  const client = createClient(() => sockets.shift()!, executor);
  await connectClient(client, first);
  await openRemoteSession(first);
  assert.equal(executor.opened, 1);
  first.close();
  assert.equal(session.closed, false);
  await connectClient(client, second);
  await openRemoteSession(second);
  assert.equal(executor.opened, 1);
  assert.equal(session.closed, false);
  await client.close();
  assert.equal(session.closed, true);
}

async function testResourceReconnect(): Promise<void> {
  const first = new FakeSocket();
  const second = new FakeSocket();
  const sockets = [first, second];
  let nextId = 0;
  const client = createClient(() => sockets.shift()!, new TestExecutor(), () => `id-${nextId += 1}`);
  await connectClient(client, first, 'id-1');
  const resource = await registerTestResource(client, first);
  first.close();
  const secondConnect = client.connect();
  await authenticateSocket(second);
  await waitForMessage(second, 'resource.register');
  const restored = messageOfType(second, 'resource.register');
  assert.deepEqual(restored.resource, resource);
  sendResourceRegistered(second, restored);
  await secondConnect;
  await client.close();
}

function enrolledState(serverUrl = 'https://crawler.example/'): BrowserClientState {
  return { schemaVersion: 1, serverUrl, clientId: 'client-1', credentialId: 'credential-1', credential: 'secret-1', registeredAt: '2026-10-16T00:00:00.000Z' };
}

function createClient(
  createSocket: () => FakeSocket,
  executor: BrowserExecutor,
  randomUUID: () => string = () => 'process-1'
): BrowserClient {
  return new BrowserClient({
    serverUrl: 'https://crawler.example',
    executor,
    stateStore: new MemoryStateStore(enrolledState()),
    fetch: discoveryFetch,
    webSocketFactory: { create: createSocket },
    randomUUID,
  });
}

async function connectClient(client: BrowserClient, socket: FakeSocket, processId = 'process-1'): Promise<void> {
  const connecting = client.connect();
  await authenticateSocket(socket);
  assert.deepEqual(await connecting, { clientId: 'client-1', workerId: 'worker-1', processInstanceId: processId });
}

async function authenticateSocket(socket: FakeSocket): Promise<void> {
  await waitFor(() => socket.listenerCount('open') === 1);
  socket.open();
  await waitFor(() => socket.sent.length === 1);
  socket.serverSend({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'client.authenticated',
    workerId: 'worker-1',
    heartbeatIntervalMs: 60_000,
  });
}

async function openRemoteSession(socket: FakeSocket): Promise<void> {
  socket.serverSend({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'session.open',
    request: {
      sessionId: 'session-1',
      leaseId: 'lease-1',
      source: { type: 'managed-profile', navigationPolicy: 'navigate-to-target' },
    },
  });
  await waitForMessage(socket, 'session.ready');
}

async function registerTestResource(client: BrowserClient, socket: FakeSocket) {
  const registering = client.registerResource({ kind: 'tab', url: 'https://example.test/chapter', title: 'Chapter' });
  await waitForMessage(socket, 'resource.register');
  const message = messageOfType(socket, 'resource.register');
  sendResourceRegistered(socket, message);
  return registering;
}

function sendResourceRegistered(socket: FakeSocket, message: Record<string, any>): void {
  socket.serverSend({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'resource.registered',
    requestId: message.requestId,
    resource: message.resource,
  });
}

async function revokeTestResource(client: BrowserClient, socket: FakeSocket, resourceId: string): Promise<void> {
  const revoking = client.revokeResource(resourceId);
  await waitForMessageCount(socket, 'resource.revoke', 1);
  const message = messageOfType(socket, 'resource.revoke');
  socket.serverSend({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'resource.revoked',
    requestId: message.requestId,
    resourceId,
  });
  await revoking;
}

function messageOfType(socket: FakeSocket, type: string): Record<string, any> {
  return socket.jsonMessages().find((message) => message.type === type)!;
}

class MemoryStateStore implements ClientStateStore {
  constructor(public state?: BrowserClientState) {}
  async get(): Promise<BrowserClientState | undefined> {
    return this.state;
  }
  async set(state: BrowserClientState): Promise<void> {
    this.state = state;
  }
  async clear(): Promise<void> {
    this.state = undefined;
  }
}

class TestExecutor implements BrowserExecutor {
  closed = false;
  opened = 0;

  constructor(private readonly session: BrowserSession = new ImmediateSession()) {}

  async describe(): Promise<BrowserCapabilities> {
    return capabilities;
  }
  async openSession(): Promise<BrowserSession> {
    this.opened += 1;
    return this.session;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

class ImmediateSession implements BrowserSession {
  async execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    if (command.type === 'page.get-content') return { type: command.type, url: 'about:blank', html: '' };
    if (command.type === 'page.focus') return { type: command.type };
    return { type: command.type, url: command.type === 'page.navigate' ? command.url : 'about:blank' };
  }
  async close(): Promise<void> {}
}

class ControlledSession implements BrowserSession {
  readonly started: BrowserCommand[] = [];
  closed = false;
  maxConcurrent = 0;
  private concurrent = 0;
  private readonly pending: Array<(result: BrowserCommandResult) => void> = [];

  execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    this.started.push(command);
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    return new Promise((resolve) => {
      this.pending.push((result) => {
        this.concurrent -= 1;
        resolve(result);
      });
    });
  }
  releaseNext(result: BrowserCommandResult): void {
    const resolve = this.pending.shift();
    if (!resolve) throw new Error('No command is waiting.');
    resolve(result);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

type SocketEventType = 'open' | 'message' | 'error' | 'close';
type SocketListener = (() => void) | ((event: BrowserClientSocketMessageEvent) => void) | ((event: BrowserClientSocketCloseEvent) => void);

class FakeSocket implements BrowserClientSocket {
  readyState = 0;
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  readonly sent: string[] = [];
  private readonly listeners = new Map<SocketEventType, Set<SocketListener>>();

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.emit('close', { code: 1000, reason: 'closed' });
  }
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: BrowserClientSocketMessageEvent) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: (event: BrowserClientSocketCloseEvent) => void): void;
  addEventListener(type: SocketEventType, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: 'open', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: BrowserClientSocketMessageEvent) => void): void;
  removeEventListener(type: 'error', listener: () => void): void;
  removeEventListener(type: 'close', listener: (event: BrowserClientSocketCloseEvent) => void): void;
  removeEventListener(type: SocketEventType, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }
  open(): void {
    this.readyState = 1;
    this.emit('open');
  }
  serverSend(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }
  listenerCount(type: SocketEventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  jsonMessages(): Array<Record<string, unknown>> {
    return this.sent.map((message) => JSON.parse(message) as Record<string, unknown>);
  }
  private emit(type: SocketEventType, event?: BrowserClientSocketMessageEvent | BrowserClientSocketCloseEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (value?: BrowserClientSocketMessageEvent | BrowserClientSocketCloseEvent) => void)(event);
    }
  }
}

function commandMessage(requestId: string, type: BrowserCommand['type']): Record<string, unknown> {
  return {
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.execute',
    requestId,
    sessionId: 'session-1',
    leaseId: 'lease-1',
    command: { type },
  };
}

async function discoveryFetch(): Promise<Response> {
  return jsonResponse({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    apiSecurityMode: 'public',
    endpoints: {
      enroll: '/api/browser-clients/enroll',
      controlWebSocket: '/api/browser-clients/connect',
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitForMessage(socket: FakeSocket, type: string): Promise<void> {
  await waitFor(() => socket.jsonMessages().some((message) => message.type === type));
}

async function waitForMessageCount(socket: FakeSocket, type: string, count: number): Promise<void> {
  await waitFor(() => socket.jsonMessages().filter((message) => message.type === type).length >= count);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out while waiting for test condition.');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
