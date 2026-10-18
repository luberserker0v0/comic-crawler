import {
  BROWSER_CLIENT_DISCOVERY_PATH,
  BROWSER_CLIENT_PROTOCOL_VERSION,
  type BrowserClientConnection,
  type BrowserClientDiscovery,
  type BrowserClientEnrollmentCredentials,
  type BrowserClientEnrollmentResponse,
  type BrowserClientSocket,
  type BrowserClientSocketCloseEvent,
  type BrowserClientSocketMessageEvent,
  type BrowserClientState,
  type BrowserClientToServerMessage,
  type BrowserCommandEnvelope,
  type BrowserExecutor,
  type BrowserResourceDescriptor,
  type BrowserResourceRegistration,
  type BrowserServerToClientMessage,
  type BrowserSession,
  type ClientStateStore,
  type WebSocketFactory,
} from './contracts';
import { BrowserClientError, toBrowserCommandError } from './errors';
import { decodeSocketMessage, parseServerMessage } from './protocol';

const SOCKET_OPEN = 1;

export interface BrowserClientOptions {
  serverUrl: string;
  executor: BrowserExecutor;
  stateStore: ClientStateStore;
  webSocketFactory?: WebSocketFactory;
  fetch?: typeof fetch;
  randomUUID?: () => string;
  connectTimeoutMs?: number;
}

export interface BrowserClientEnrollOptions {
  name?: string;
  credentials?: BrowserClientEnrollmentCredentials;
}

interface ActiveSession {
  sessionId: string;
  leaseId: string;
  session: BrowserSession;
  abortController: AbortController;
  commandTail: Promise<void>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export class BrowserClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly processInstanceId: string;
  private readonly connectTimeoutMs: number;
  private socket?: BrowserClientSocket;
  private activeSession?: ActiveSession;
  private connection?: BrowserClientConnection;
  private authentication?: Deferred<BrowserClientConnection>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private messageTail: Promise<void> = Promise.resolve();
  private readonly pendingControls = new Map<string, Deferred<BrowserResourceDescriptor | string>>();
  private readonly registeredResources = new Map<string, BrowserResourceDescriptor>();
  private readonly randomUUID: () => string;
  private closing = false;

  constructor(private readonly options: BrowserClientOptions) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory();
    this.randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
    this.processInstanceId = this.randomUUID();
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  }

  async enroll(options: BrowserClientEnrollOptions = {}): Promise<BrowserClientState> {
    const discovery = await this.discover();
    const credentials = options.credentials;
    if (discovery.apiSecurityMode === 'token' && !credentials) {
      throw new BrowserClientError(
        'The ComicCrawler Server requires a user ID and user API token for Browser Client enrollment.',
        'INVALID_STATE'
      );
    }
    const capabilities = await this.options.executor.describe();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (credentials) {
      headers['x-comiccrawler-user-id'] = credentials.userId;
      headers.authorization = `Bearer ${credentials.userToken}`;
    }
    const response = await this.fetchImplementation(new URL(discovery.endpoints.enroll, this.options.serverUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: options.name, capabilities }),
    });
    const body = await readDataResponse<BrowserClientEnrollmentResponse>(response, 'Browser Client enrollment');
    const state: BrowserClientState = {
      schemaVersion: 1,
      serverUrl: normalizeServerUrl(this.options.serverUrl),
      clientId: body.clientId,
      credentialId: body.credentialId,
      credential: body.credential,
      registeredAt: body.registeredAt,
    };
    await this.options.stateStore.set(state);
    return state;
  }

  async connect(): Promise<BrowserClientConnection> {
    if (this.socket) throw new BrowserClientError('Browser Client is already connected.', 'INVALID_STATE');
    const state = await this.options.stateStore.get();
    if (!state) throw new BrowserClientError('Browser Client is not enrolled.', 'INVALID_STATE');
    if (normalizeServerUrl(state.serverUrl) !== normalizeServerUrl(this.options.serverUrl)) {
      throw new BrowserClientError('Browser Client state belongs to a different server.', 'INVALID_STATE');
    }

    const [discovery, capabilities] = await Promise.all([
      this.discover(),
      this.options.executor.describe(),
    ]);
    const socket = this.webSocketFactory.create(toWebSocketUrl(discovery.endpoints.controlWebSocket, this.options.serverUrl));
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.closing = false;
    this.authentication = deferred<BrowserClientConnection>();
    socket.addEventListener('message', this.handleSocketMessage);
    socket.addEventListener('close', this.handleSocketClose);

    try {
      await waitForSocketOpen(socket, this.connectTimeoutMs);
      this.send({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'client.authenticate',
        clientId: state.clientId,
        credential: state.credential,
        processInstanceId: this.processInstanceId,
        capabilities,
      });
      const connection = await withTimeout(
        this.authentication.promise,
        this.connectTimeoutMs,
        'Browser Client authentication timed out.'
      );
      this.connection = {
        clientId: state.clientId,
        workerId: connection.workerId,
        processInstanceId: this.processInstanceId,
      };
      await this.restoreResources();
      return this.connection;
    } catch (error) {
      await this.disconnectSocket();
      throw error;
    } finally {
      this.authentication = undefined;
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    this.stopHeartbeat();
    let closeError: unknown;
    try {
      await this.closeActiveSession();
    } catch (error) {
      closeError = error;
    } finally {
      await this.disconnectSocket();
      this.connection = undefined;
    }
    if (closeError) throw closeError;
  }

  async close(): Promise<void> {
    await this.disconnect();
    await this.options.executor.close();
  }

  getConnection(): BrowserClientConnection | undefined {
    return this.connection;
  }

  async registerResource(input: BrowserResourceRegistration): Promise<BrowserResourceDescriptor> {
    this.requireConnected();
    const resource: BrowserResourceDescriptor = {
      resourceId: input.resourceId ?? `brr_${this.randomUUID()}`,
      kind: input.kind,
      url: input.url,
      ...(input.title === undefined ? {} : { title: input.title }),
    };
    await this.options.executor.registerResource?.(resource, input.localHandle);
    try {
      const result = await this.publishResource(resource);
      this.registeredResources.set(resource.resourceId, result);
      return result;
    } catch (error) {
      await this.options.executor.revokeResource?.(resource.resourceId).catch(() => undefined);
      throw error;
    }
  }

  async revokeResource(resourceId: string): Promise<void> {
    this.requireConnected();
    const requestId = `brc_${this.randomUUID()}`;
    const pending = deferred<BrowserResourceDescriptor | string>();
    this.pendingControls.set(requestId, pending);
    try {
      this.send({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'resource.revoke',
        requestId,
        resourceId,
      });
      await withTimeout(pending.promise, this.connectTimeoutMs, 'Browser resource revocation timed out.');
      await this.options.executor.revokeResource?.(resourceId);
      this.registeredResources.delete(resourceId);
    } finally {
      this.pendingControls.delete(requestId);
    }
  }

  private readonly handleSocketMessage = (event: BrowserClientSocketMessageEvent): void => {
    this.messageTail = this.messageTail
      .then(() => this.processSocketMessage(event))
      .catch(async (error) => {
        this.authentication?.reject(error);
        await this.closeActiveSession().catch(() => undefined);
        await this.disconnectSocket();
        this.connection = undefined;
      });
  };

  private readonly handleSocketClose = (event: BrowserClientSocketCloseEvent): void => {
    const reason = event.reason ? `: ${event.reason}` : '';
    this.stopHeartbeat();
    this.socket = undefined;
    this.connection = undefined;
    this.authentication?.reject(new BrowserClientError(`Browser Client connection closed${reason}`, 'BROWSER_CLOSED', true));
    // Keep the consumer-owned browser session alive across an unexpected
    // transport disconnect. The Server may reopen the same lease/session after
    // this process reconnects. Explicit disconnect() still closes it.
  };

  private async processSocketMessage(event: BrowserClientSocketMessageEvent): Promise<void> {
    const message = parseServerMessage(await decodeSocketMessage(event.data));
    switch (message.type) {
      case 'client.authenticated':
        this.acceptAuthentication(message);
        break;
      case 'client.rejected':
        this.authentication?.reject(new BrowserClientError(message.reason, 'INVALID_STATE'));
        break;
      case 'resource.registered':
        this.pendingControls.get(message.requestId)?.resolve(message.resource);
        break;
      case 'resource.revoked':
        this.pendingControls.get(message.requestId)?.resolve(message.resourceId);
        break;
      case 'resource.rejected':
        this.pendingControls.get(message.requestId)?.reject(new BrowserClientError(
          message.error.message,
          message.error.code,
          message.error.retryable
        ));
        break;
      case 'session.open':
        await this.openSession(message);
        break;
      case 'session.close':
        await this.closeSession(message.sessionId, message.leaseId);
        break;
      case 'command.execute':
        this.queueCommand(message);
        break;
    }
  }

  private acceptAuthentication(message: Extract<BrowserServerToClientMessage, { type: 'client.authenticated' }>): void {
    const stateConnection = this.authentication;
    if (!stateConnection) throw new BrowserClientError('Unexpected authentication response.', 'INVALID_STATE');
    const processInstanceId = this.connection?.processInstanceId ?? '';
    stateConnection.resolve({
      clientId: '',
      workerId: message.workerId,
      processInstanceId,
    });
    this.startHeartbeat(message.heartbeatIntervalMs);
  }

  private async openSession(message: Extract<BrowserServerToClientMessage, { type: 'session.open' }>): Promise<void> {
    const { sessionId, leaseId } = message.request;
    if (this.activeSession) {
      if (this.activeSession.sessionId === sessionId && this.activeSession.leaseId === leaseId) {
        this.send({
          protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
          type: 'session.ready',
          sessionId,
          leaseId,
        });
        return;
      }
      this.sendSessionFailure(sessionId, leaseId, new BrowserClientError('Browser Worker is busy.', 'INVALID_STATE', true));
      return;
    }
    const abortController = new AbortController();
    try {
      const session = await this.options.executor.openSession(message.request, abortController.signal);
      this.activeSession = {
        sessionId,
        leaseId,
        session,
        abortController,
        commandTail: Promise.resolve(),
      };
      this.send({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'session.ready',
        sessionId,
        leaseId,
      });
    } catch (error) {
      this.sendSessionFailure(sessionId, leaseId, error);
    }
  }

  private queueCommand(message: Extract<BrowserServerToClientMessage, { type: 'command.execute' }>): void {
    const active = this.activeSession;
    if (!active || active.sessionId !== message.sessionId || active.leaseId !== message.leaseId) {
      this.sendCommandError(message, new BrowserClientError('Command does not match the active lease and session.', 'LEASE_MISMATCH'));
      return;
    }
    active.commandTail = active.commandTail
      .then(() => this.executeCommand(active, message))
      .catch(() => undefined);
  }

  private async executeCommand(active: ActiveSession, message: BrowserCommandEnvelope): Promise<void> {
    if (this.activeSession !== active) {
      this.sendCommandError(message, new BrowserClientError('Browser session is closed.', 'INVALID_STATE'));
      return;
    }
    try {
      const result = await active.session.execute(message.command, active.abortController.signal);
      this.send({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'command.result',
        requestId: message.requestId,
        ok: true,
        result,
      });
    } catch (error) {
      this.sendCommandError(message, error);
    }
  }

  private async closeSession(sessionId: string, leaseId: string): Promise<void> {
    const active = this.activeSession;
    if (!active || active.sessionId !== sessionId || active.leaseId !== leaseId) return;
    await this.closeActiveSession();
    this.send({
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'session.closed',
      sessionId,
      leaseId,
    });
  }

  private async closeActiveSession(): Promise<void> {
    const active = this.activeSession;
    if (!active) return;
    this.activeSession = undefined;
    active.abortController.abort();
    await active.session.close();
  }

  private sendSessionFailure(sessionId: string, leaseId: string, error: unknown): void {
    this.send({
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'session.failed',
      sessionId,
      leaseId,
      error: toBrowserCommandError(error),
    });
  }

  private sendCommandError(message: Pick<BrowserCommandEnvelope, 'requestId'>, error: unknown): void {
    this.send({
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'command.result',
      requestId: message.requestId,
      ok: false,
      error: toBrowserCommandError(error),
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connection) return;
      this.send({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'client.heartbeat',
        workerId: this.connection.workerId,
      });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private send(message: BrowserClientToServerMessage): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) {
      throw new BrowserClientError('Browser Client WebSocket is not open.', 'BROWSER_CLOSED', true);
    }
    this.socket.send(JSON.stringify(message));
  }

  private requireConnected(): void {
    if (!this.connection) throw new BrowserClientError('Browser Client is not connected.', 'INVALID_STATE');
  }

  private async restoreResources(): Promise<void> {
    for (const resource of this.registeredResources.values()) await this.publishResource(resource);
  }

  private async publishResource(resource: BrowserResourceDescriptor): Promise<BrowserResourceDescriptor> {
    const requestId = `brc_${this.randomUUID()}`;
    const pending = deferred<BrowserResourceDescriptor | string>();
    this.pendingControls.set(requestId, pending);
    try {
      this.send({
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'resource.register',
        requestId,
        resource,
      });
      const result = await withTimeout(pending.promise, this.connectTimeoutMs, 'Browser resource registration timed out.');
      if (typeof result === 'string') throw new BrowserClientError('Invalid resource registration response.', 'INVALID_STATE');
      return result;
    } finally {
      this.pendingControls.delete(requestId);
    }
  }

  private async disconnectSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    const error = new BrowserClientError('Browser Client connection closed.', 'BROWSER_CLOSED', true);
    for (const pending of this.pendingControls.values()) pending.reject(error);
    this.pendingControls.clear();
    socket.removeEventListener('message', this.handleSocketMessage);
    socket.removeEventListener('close', this.handleSocketClose);
    if (socket.readyState === SOCKET_OPEN || socket.readyState === 0) socket.close(1000, 'Client disconnected');
  }

  private async discover(): Promise<BrowserClientDiscovery> {
    const response = await this.fetchImplementation(new URL(BROWSER_CLIENT_DISCOVERY_PATH, this.options.serverUrl));
    const discovery = await readDataResponse<BrowserClientDiscovery>(response, 'Browser Client discovery');
    if (discovery.protocolVersion !== BROWSER_CLIENT_PROTOCOL_VERSION) {
      throw new BrowserClientError('ComicCrawler returned an unsupported Browser Client protocol.', 'INVALID_STATE');
    }
    return discovery;
  }
}

function defaultWebSocketFactory(): WebSocketFactory {
  return {
    create(url, protocols) {
      if (typeof globalThis.WebSocket !== 'function') {
        throw new BrowserClientError('This runtime requires an injected WebSocketFactory.', 'INVALID_STATE');
      }
      return new globalThis.WebSocket(url, protocols) as unknown as BrowserClientSocket;
    },
  };
}

function waitForSocketOpen(socket: BrowserClientSocket, timeoutMs: number): Promise<void> {
  if (socket.readyState === SOCKET_OPEN) return Promise.resolve();
  return withTimeout(new Promise<void>((resolve, reject) => {
    const opened = () => {
      cleanup();
      resolve();
    };
    const errored = () => {
      cleanup();
      reject(new BrowserClientError('Browser Client WebSocket failed to open.', 'BROWSER_CLOSED', true));
    };
    const closed = (event: BrowserClientSocketCloseEvent) => {
      cleanup();
      reject(new BrowserClientError(`Browser Client WebSocket closed before opening${event.reason ? `: ${event.reason}` : ''}.`, 'BROWSER_CLOSED', true));
    };
    const cleanup = () => {
      socket.removeEventListener('open', opened);
      socket.removeEventListener('error', errored);
      socket.removeEventListener('close', closed);
    };
    socket.addEventListener('open', opened);
    socket.addEventListener('error', errored);
    socket.addEventListener('close', closed);
  }), timeoutMs, 'Browser Client WebSocket connection timed out.');
}

async function readDataResponse<T>(response: Response, operation: string): Promise<T> {
  const body = await response.json() as { data?: T; error?: string };
  if (!response.ok || !body.data) {
    throw new BrowserClientError(body.error ?? `${operation} failed (${response.status}).`, 'INVALID_STATE');
  }
  return body.data;
}

function toWebSocketUrl(path: string, serverUrl: string): string {
  const url = new URL(path, serverUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new BrowserClientError(`Unsupported WebSocket URL protocol "${url.protocol}".`, 'INVALID_STATE');
  }
  return url.toString();
}

function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new BrowserClientError(message, 'TIMEOUT', true)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
