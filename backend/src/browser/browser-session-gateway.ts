import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { WebSocket as WebSocketState } from 'ws';
import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
  type BrowserCapabilities,
  type BrowserClientToServerMessage,
  type BrowserCommand,
  type BrowserCommandError,
  type BrowserCommandResult,
  type BrowserResourceDescriptor,
  type BrowserServerToClientMessage,
  type OpenBrowserSessionRequest,
} from '@comiccrawler/browser-client-sdk';
import type { ApiSecurityService } from '../security/api-security';
import type { BrowserClientRegistry } from './browser-client-registry';

export interface BrowserWorker {
  workerId: string;
  clientId: string;
  name: string;
  ownerUserId: string;
  processInstanceId: string;
  capabilities: BrowserCapabilities;
  connectedAt: string;
  lastHeartbeatAt: string;
  online: boolean;
  activeSessionId?: string;
}

export interface OpenGatewaySessionRequest extends Omit<OpenBrowserSessionRequest, 'sessionId'> {
  workerId: string;
  sessionId?: string;
  timeoutMs?: number;
}

export interface GatewaySession {
  sessionId: string;
  leaseId: string;
  workerId: string;
  ownerUserId: string;
  source: OpenBrowserSessionRequest['source'];
  initialPageClaimed: boolean;
  state: 'opening' | 'active' | 'closing';
  openedAt: string;
}

export interface BrowserResource extends BrowserResourceDescriptor {
  workerId: string;
  ownerUserId: string;
  registeredAt: string;
}

interface WorkerConnection {
  socket: WebSocket;
  worker: BrowserWorker;
  connectionId: string;
}

interface PendingOperation<T> {
  workerId: string;
  sessionId?: string;
  resolve(value: T): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface GatewayOptions {
  authenticationTimeoutMs?: number;
  operationTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

export class BrowserSessionGateway {
  private readonly workers = new Map<string, BrowserWorker>();
  private readonly workerIdByProcess = new Map<string, string>();
  private readonly connections = new Map<string, WorkerConnection>();
  private readonly sessions = new Map<string, GatewaySession>();
  private readonly resources = new Map<string, BrowserResource>();
  private readonly pendingSessionOpen = new Map<string, PendingOperation<void>>();
  private readonly pendingSessionClose = new Map<string, PendingOperation<void>>();
  private readonly pendingCommands = new Map<string, PendingOperation<BrowserCommandResult>>();
  private readonly changeListeners = new Set<() => void>();
  private readonly authenticationTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly heartbeatTimer: NodeJS.Timeout;

  constructor(
    private readonly registry: BrowserClientRegistry,
    private readonly security?: ApiSecurityService,
    options: GatewayOptions = {}
  ) {
    this.authenticationTimeoutMs = options.authenticationTimeoutMs ?? 10_000;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45_000;
    this.heartbeatTimer = setInterval(() => this.closeStaleConnections(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  acceptConnection(socket: WebSocket): void {
    let authenticatedWorkerId: string | undefined;
    const authenticationTimer = setTimeout(() => {
      socket.close(4008, 'Browser Client authentication timed out.');
    }, this.authenticationTimeoutMs);
    authenticationTimer.unref();

    socket.on('message', (data, binary) => {
      if (binary) {
        socket.close(4002, 'Binary Browser Client messages are not supported.');
        return;
      }
      void this.handleMessage(socket, data.toString(), authenticatedWorkerId).then((workerId) => {
        if (!authenticatedWorkerId && workerId) {
          authenticatedWorkerId = workerId;
          clearTimeout(authenticationTimer);
        }
      }).catch((error) => {
        socket.close(4002, errorMessage(error));
      });
    });
    socket.once('close', () => {
      clearTimeout(authenticationTimer);
      if (authenticatedWorkerId) this.disconnectWorker(authenticatedWorkerId, 'Browser Client disconnected.');
    });
  }

  listWorkers(ownerUserId?: string): Array<BrowserWorker> {
    return [...this.workers.values()]
      .filter((worker) => ownerUserId === undefined || worker.ownerUserId === ownerUserId)
      .map((worker) => ({ ...worker, capabilities: { ...worker.capabilities } }));
  }

  getWorker(workerId: string): BrowserWorker | undefined {
    const worker = this.workers.get(workerId);
    return worker ? { ...worker, capabilities: { ...worker.capabilities } } : undefined;
  }

  listResources(ownerUserId?: string, workerId?: string): BrowserResource[] {
    return [...this.resources.values()]
      .filter((resource) => ownerUserId === undefined || resource.ownerUserId === ownerUserId)
      .filter((resource) => workerId === undefined || resource.workerId === workerId)
      .map((resource) => ({ ...resource }));
  }

  getResource(resourceId: string): BrowserResource | undefined {
    const resource = this.resources.get(resourceId);
    return resource ? { ...resource } : undefined;
  }

  countOnline(ownerUserId: string): number {
    return [...this.workers.values()].filter((worker) => worker.ownerUserId === ownerUserId && worker.online).length;
  }

  async openSession(request: OpenGatewaySessionRequest): Promise<GatewaySession> {
    const connection = this.requireOnlineConnection(request.workerId);
    this.assertValidSessionSource(connection.worker, request.source);
    if (connection.worker.activeSessionId) {
      throw new Error(`Browser Worker "${request.workerId}" is busy.`);
    }
    const sessionId = request.sessionId ?? `bs_${randomUUID()}`;
    if (this.sessions.has(sessionId)) throw new Error(`Browser session "${sessionId}" already exists.`);
    const session: GatewaySession = {
      sessionId,
      leaseId: request.leaseId,
      workerId: request.workerId,
      ownerUserId: connection.worker.ownerUserId,
      source: request.source,
      initialPageClaimed: false,
      state: 'opening',
      openedAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, session);
    connection.worker.activeSessionId = sessionId;
    this.emitChange();
    const pending = this.createPending<void>(
      this.pendingSessionOpen,
      sessionId,
      request.workerId,
      sessionId,
      request.timeoutMs,
      `Browser session "${sessionId}" timed out while opening.`
    );
    try {
      this.send(connection.socket, {
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'session.open',
        request: {
          sessionId,
          leaseId: request.leaseId,
          source: request.source,
          renderContext: request.renderContext,
        },
      });
      await pending;
      session.state = 'active';
      return { ...session };
    } catch (error) {
      this.sendSessionCloseBestEffort(connection, session);
      this.removeSession(sessionId);
      throw error;
    } finally {
      this.clearPending(this.pendingSessionOpen, sessionId);
    }
  }

  async execute(
    sessionId: string,
    command: BrowserCommand,
    timeoutMs = this.operationTimeoutMs
  ): Promise<BrowserCommandResult> {
    const session = this.requireActiveSession(sessionId);
    const connection = this.requireOnlineConnection(session.workerId);
    assertCapability(connection.worker.capabilities, command);
    const requestId = `br_${randomUUID()}`;
    const pending = this.createPending<BrowserCommandResult>(
      this.pendingCommands,
      requestId,
      session.workerId,
      sessionId,
      timeoutMs,
      `Browser command "${command.type}" timed out.`
    );
    try {
      this.send(connection.socket, {
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'command.execute',
        requestId,
        leaseId: session.leaseId,
        sessionId,
        command,
      });
      return await pending;
    } finally {
      this.clearPending(this.pendingCommands, requestId);
    }
  }

  claimInitialPage(sessionId: string): { source: OpenBrowserSessionRequest['source']; initial: boolean } {
    const session = this.requireActiveSession(sessionId);
    const initial = !session.initialPageClaimed;
    session.initialPageClaimed = true;
    return { source: session.source, initial };
  }

  async closeSession(sessionId: string, timeoutMs = this.operationTimeoutMs): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const connection = this.connections.get(session.workerId);
    if (!connection || connection.socket.readyState !== WebSocketState.OPEN) {
      this.removeSession(sessionId);
      return;
    }
    session.state = 'closing';
    this.rejectPendingCommands(sessionId, new Error(`Browser session "${sessionId}" is closing.`));
    const pending = this.createPending<void>(
      this.pendingSessionClose,
      sessionId,
      session.workerId,
      sessionId,
      timeoutMs,
      `Browser session "${sessionId}" timed out while closing.`
    );
    try {
      this.send(connection.socket, {
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'session.close',
        sessionId,
        leaseId: session.leaseId,
      });
      await pending;
    } catch (error) {
      connection.socket.close(4008, 'Browser session close timed out.');
      throw error;
    } finally {
      this.clearPending(this.pendingSessionClose, sessionId);
      this.removeSession(sessionId);
    }
  }

  revokeClient(clientId: string, reason = 'Browser Client was revoked.'): void {
    for (const connection of [...this.connections.values()]) {
      if (connection.worker.clientId === clientId) connection.socket.close(4003, reason);
    }
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  dispose(): void {
    clearInterval(this.heartbeatTimer);
    for (const connection of this.connections.values()) connection.socket.close(1001, 'Server stopped.');
    const error = new Error('Browser Session Gateway was stopped.');
    this.rejectAll(this.pendingSessionOpen, error);
    this.rejectAll(this.pendingSessionClose, error);
    this.rejectAll(this.pendingCommands, error);
    this.connections.clear();
    this.sessions.clear();
    this.resources.clear();
    this.changeListeners.clear();
  }

  private async handleMessage(socket: WebSocket, raw: string, workerId?: string): Promise<string | undefined> {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.protocolVersion !== BROWSER_CLIENT_PROTOCOL_VERSION || typeof parsed.type !== 'string') {
      throw new Error('Invalid Browser Client protocol message.');
    }
    if (!workerId) return this.authenticateSocket(socket, parsed);
    const connection = this.connections.get(workerId);
    if (!connection || connection.socket !== socket) throw new Error('Browser Client connection is not active.');
    const message = parsed as unknown as BrowserClientToServerMessage;
    switch (message.type) {
      case 'client.heartbeat':
        if (message.workerId !== workerId) throw new Error('Heartbeat Worker identity does not match connection.');
        connection.worker.lastHeartbeatAt = new Date().toISOString();
        break;
      case 'resource.register':
        this.handleResourceControl(connection, message.requestId, () => {
          this.registerResource(connection.worker, message.requestId, message.resource);
        });
        break;
      case 'resource.revoke':
        this.handleResourceControl(connection, message.requestId, () => {
          this.revokeResource(connection.worker, message.requestId, message.resourceId);
        });
        break;
      case 'session.ready':
        this.resolveSessionOpen(workerId, message.sessionId, message.leaseId);
        break;
      case 'session.failed':
        this.rejectSessionOpen(workerId, message.sessionId, message.leaseId, message.error);
        break;
      case 'session.closed':
        this.resolveSessionClose(workerId, message.sessionId, message.leaseId);
        break;
      case 'command.result':
        this.resolveCommand(workerId, message);
        break;
      case 'client.authenticate':
        throw new Error('Browser Client connection is already authenticated.');
      default:
        throw new Error('Unknown Browser Client message type.');
    }
    return workerId;
  }

  private handleResourceControl(connection: WorkerConnection, requestId: string, operation: () => void): void {
    requestId = requireString(requestId, 'requestId');
    try {
      operation();
    } catch (error) {
      this.send(connection.socket, {
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'resource.rejected',
        requestId,
        error: {
          code: 'INVALID_STATE',
          message: errorMessage(error),
          retryable: false,
        },
      });
    }
  }

  private registerResource(worker: BrowserWorker, requestId: string, value: BrowserResourceDescriptor): void {
    if (worker.capabilities.executionMode !== 'existing-tab') {
      throw new Error('Only an existing-tab Browser Worker can register browser resources.');
    }
    requestId = requireString(requestId, 'requestId');
    const resource = requireResource(value);
    const existing = this.resources.get(resource.resourceId);
    if (existing && existing.workerId !== worker.workerId) {
      throw new Error(`Browser resource "${resource.resourceId}" is already registered by another Worker.`);
    }
    const registered: BrowserResource = {
      ...resource,
      workerId: worker.workerId,
      ownerUserId: worker.ownerUserId,
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    };
    this.resources.set(resource.resourceId, registered);
    this.send(this.requireOnlineConnection(worker.workerId).socket, {
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'resource.registered',
      requestId,
      resource,
    });
    this.emitChange();
  }

  private revokeResource(worker: BrowserWorker, requestId: string, resourceId: string): void {
    requestId = requireString(requestId, 'requestId');
    resourceId = requireString(resourceId, 'resourceId');
    const resource = this.resources.get(resourceId);
    if (!resource || resource.workerId !== worker.workerId) {
      throw new Error(`Browser resource "${resourceId}" was not found for this Worker.`);
    }
    const inUse = [...this.sessions.values()].some((session) =>
      session.workerId === worker.workerId
      && session.source.type === 'existing-resource'
      && session.source.resourceId === resourceId);
    if (inUse) throw new Error(`Browser resource "${resourceId}" is in use.`);
    this.resources.delete(resourceId);
    this.send(this.requireOnlineConnection(worker.workerId).socket, {
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'resource.revoked',
      requestId,
      resourceId,
    });
    this.emitChange();
  }

  private async authenticateSocket(socket: WebSocket, message: Record<string, unknown>): Promise<string | undefined> {
    if (message.type !== 'client.authenticate') throw new Error('The first Browser Client message must authenticate.');
    const clientId = requireString(message.clientId, 'clientId');
    const credential = requireString(message.credential, 'credential');
    const processInstanceId = requireString(message.processInstanceId, 'processInstanceId');
    const capabilities = requireCapabilities(message.capabilities);
    const record = this.registry.authenticateCredential(clientId, credential);
    if (!record) {
      this.rejectAuthentication(socket, 'Browser Client credential is invalid.');
      return undefined;
    }
    const principal = this.security?.principalForUser(record.ownerUserId);
    if (this.security && !principal) {
      this.rejectAuthentication(socket, 'Browser Client owner is disabled or unknown.');
      return undefined;
    }
    if (principal && this.security && !this.security.hasPermission(principal, 'browser-client:session-own')) {
      this.rejectAuthentication(socket, 'Browser Client owner no longer has session permission.');
      return undefined;
    }
    if (principal?.limits.maxOnlineBrowserWorkers !== undefined
      && this.countOnline(record.ownerUserId) >= principal.limits.maxOnlineBrowserWorkers) {
      this.rejectAuthentication(socket, 'The maximum number of online Browser Workers has been reached.');
      return undefined;
    }
    const processKey = `${clientId}\0${processInstanceId}`;
    const existingWorkerId = this.workerIdByProcess.get(processKey);
    const existing = existingWorkerId ? this.connections.get(existingWorkerId) : undefined;
    if (existing?.socket.readyState === WebSocketState.OPEN) {
      this.rejectAuthentication(socket, 'This Browser Client process already has an active connection.', 4009);
      return undefined;
    }
    const workerId = existingWorkerId ?? `bw_${randomUUID()}`;
    const now = new Date().toISOString();
    const worker: BrowserWorker = {
      workerId,
      clientId,
      name: record.name,
      ownerUserId: record.ownerUserId,
      processInstanceId,
      capabilities,
      connectedAt: now,
      lastHeartbeatAt: now,
      online: true,
    };
    await this.registry.markConnected(clientId);
    this.workers.set(workerId, worker);
    this.workerIdByProcess.set(processKey, workerId);
    this.connections.set(workerId, {
      socket,
      worker,
      connectionId: `bwc_${randomUUID()}`,
    });
    this.send(socket, {
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'client.authenticated',
      workerId,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    });
    this.emitChange();
    return workerId;
  }

  private rejectAuthentication(socket: WebSocket, reason: string, code = 4003): void {
    this.send(socket, {
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      type: 'client.rejected',
      reason,
    });
    socket.close(code, reason);
  }

  private resolveSessionOpen(workerId: string, sessionId: string, leaseId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.assertMatchingSession(session, workerId, leaseId);
    if (session.state !== 'opening') throw new Error('Browser session is not opening.');
    const pending = this.pendingSessionOpen.get(sessionId);
    if (!pending) return;
    if (pending.workerId !== workerId) throw new Error('Browser session open Worker does not match.');
    pending.resolve();
  }

  private rejectSessionOpen(
    workerId: string,
    sessionId: string,
    leaseId: string,
    error: BrowserCommandError
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.assertMatchingSession(session, workerId, leaseId);
    const pending = this.pendingSessionOpen.get(sessionId);
    if (!pending) return;
    if (pending.workerId !== workerId) throw new Error('Browser session open Worker does not match.');
    pending.reject(commandError(error));
  }

  private resolveSessionClose(workerId: string, sessionId: string, leaseId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.assertMatchingSession(session, workerId, leaseId);
    if (session.state !== 'closing') throw new Error('Browser session is not closing.');
    const pending = this.pendingSessionClose.get(sessionId);
    if (!pending) return;
    if (pending.workerId !== workerId) throw new Error('Browser session close Worker does not match.');
    pending.resolve();
  }

  private resolveCommand(
    workerId: string,
    message: Extract<BrowserClientToServerMessage, { type: 'command.result' }>
  ): void {
    const pending = this.pendingCommands.get(message.requestId);
    if (!pending) return;
    if (pending.workerId !== workerId) throw new Error('Browser command Worker does not match.');
    if (message.ok) pending.resolve(message.result);
    else pending.reject(commandError(message.error));
  }

  private requireOnlineConnection(workerId: string): WorkerConnection {
    const connection = this.connections.get(workerId);
    if (!connection || connection.socket.readyState !== WebSocketState.OPEN) {
      throw new Error(`Browser Worker "${workerId}" is offline.`);
    }
    return connection;
  }

  private requireActiveSession(sessionId: string): GatewaySession {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'active') throw new Error(`Browser session "${sessionId}" is not active.`);
    return session;
  }

  private assertMatchingSession(session: GatewaySession, workerId: string, leaseId: string): void {
    if (session.workerId !== workerId || session.leaseId !== leaseId) {
      throw new Error('Browser session does not match the Worker and lease.');
    }
  }

  private sendSessionCloseBestEffort(connection: WorkerConnection, session: GatewaySession): void {
    if (connection.socket.readyState !== WebSocketState.OPEN) return;
    try {
      this.send(connection.socket, {
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        type: 'session.close',
        sessionId: session.sessionId,
        leaseId: session.leaseId,
      });
    } catch {
      // The disconnect handler owns cleanup once the socket closes.
    }
  }

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const worker = this.workers.get(session.workerId);
    if (worker?.activeSessionId === sessionId) worker.activeSessionId = undefined;
    this.emitChange();
  }

  private disconnectWorker(workerId: string, reason: string): void {
    const connection = this.connections.get(workerId);
    if (!connection) return;
    this.connections.delete(workerId);
    for (const [resourceId, resource] of [...this.resources]) {
      if (resource.workerId === workerId) this.resources.delete(resourceId);
    }
    connection.worker.online = false;
    const error = new Error(reason);
    for (const [sessionId, session] of [...this.sessions]) {
      if (session.workerId !== workerId) continue;
      this.clearAndReject(this.pendingSessionOpen, sessionId, error);
      this.clearAndReject(this.pendingSessionClose, sessionId, error);
      this.rejectPendingCommands(sessionId, error);
      this.removeSession(sessionId);
    }
    this.emitChange();
  }

  private assertValidSessionSource(worker: BrowserWorker, source: OpenBrowserSessionRequest['source']): void {
    if (source.type === 'managed-profile') {
      if (worker.capabilities.executionMode !== 'managed-profile') {
        throw new Error(`Browser Worker "${worker.workerId}" does not support managed-profile sessions.`);
      }
      return;
    }
    if (worker.capabilities.executionMode !== 'existing-tab') {
      throw new Error(`Browser Worker "${worker.workerId}" does not support existing-tab sessions.`);
    }
    const resource = this.resources.get(source.resourceId);
    if (!resource || resource.workerId !== worker.workerId || resource.ownerUserId !== worker.ownerUserId) {
      throw new Error(`Browser resource "${source.resourceId}" was not found for this Worker.`);
    }
    if (normalizeResourceUrl(resource.url) !== normalizeResourceUrl(source.expectedUrl)) {
      throw new Error(`Browser resource "${source.resourceId}" is not on the requested URL.`);
    }
  }

  private rejectPendingCommands(sessionId: string, error: Error): void {
    for (const [requestId, pending] of [...this.pendingCommands]) {
      if (pending.sessionId === sessionId) this.clearAndReject(this.pendingCommands, requestId, error);
    }
  }

  private closeStaleConnections(): void {
    const deadline = Date.now() - this.heartbeatTimeoutMs;
    for (const connection of this.connections.values()) {
      if (Date.parse(connection.worker.lastHeartbeatAt) < deadline) {
        connection.socket.close(4008, 'Browser Client heartbeat timed out.');
      }
    }
  }

  private createPending<T>(
    collection: Map<string, PendingOperation<T>>,
    key: string,
    workerId: string,
    sessionId: string | undefined,
    timeoutMs: number | undefined,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        collection.delete(key);
        reject(new Error(timeoutMessage));
      }, normalizeTimeout(timeoutMs ?? this.operationTimeoutMs));
      timer.unref();
      collection.set(key, { workerId, sessionId, resolve, reject, timer });
    });
  }

  private clearPending<T>(collection: Map<string, PendingOperation<T>>, key: string): void {
    const pending = collection.get(key);
    if (pending) clearTimeout(pending.timer);
    collection.delete(key);
  }

  private clearAndReject<T>(collection: Map<string, PendingOperation<T>>, key: string, error: Error): void {
    const pending = collection.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    collection.delete(key);
    pending.reject(error);
  }

  private rejectAll<T>(collection: Map<string, PendingOperation<T>>, error: Error): void {
    for (const [key] of collection) this.clearAndReject(collection, key, error);
  }

  private send(socket: WebSocket, message: BrowserServerToClientMessage): void {
    if (socket.readyState !== WebSocketState.OPEN) throw new Error('Browser Client WebSocket is not open.');
    socket.send(JSON.stringify(message));
  }

  private emitChange(): void {
    for (const listener of [...this.changeListeners]) listener();
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Browser Client field "${name}" is required.`);
  return value;
}

function requireCapabilities(value: unknown): BrowserCapabilities {
  if (!isRecord(value)) throw new Error('Browser Client capabilities are required.');
  const result = {} as BrowserCapabilities;
  if (value.executionMode !== 'existing-tab' && value.executionMode !== 'managed-profile') {
    throw new Error('Browser Client capability "executionMode" is invalid.');
  }
  result.executionMode = value.executionMode;
  for (const key of [
    'navigation',
    'renderedDom',
    'humanHandoff',
    'responsiveViewport',
  ] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(`Browser Client capability "${key}" must be boolean.`);
    result[key] = value[key];
  }
  return result;
}

function requireResource(value: BrowserResourceDescriptor): BrowserResourceDescriptor {
  if (!isRecord(value)) throw new Error('Browser resource is required.');
  const resourceId = requireString(value.resourceId, 'resource.resourceId');
  const url = requireString(value.url, 'resource.url');
  if (value.kind !== 'tab') throw new Error('Browser resource kind must be "tab".');
  if (value.title !== undefined && typeof value.title !== 'string') {
    throw new Error('Browser resource title must be a string.');
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Browser resource URL must use HTTP or HTTPS.');
  }
  return { resourceId, kind: 'tab', url, ...(value.title === undefined ? {} : { title: value.title }) };
}

function normalizeResourceUrl(value: string): string {
  return new URL(value).toString();
}

function assertCapability(capabilities: BrowserCapabilities, command: BrowserCommand): void {
  const supported = command.type === 'page.get-content' || command.type === 'page.prepare-content'
    ? capabilities.renderedDom
    : command.type === 'page.focus'
      ? capabilities.humanHandoff
      : capabilities.navigation;
  if (!supported) throw new Error(`Browser Worker does not support command "${command.type}".`);
}

function commandError(error: BrowserCommandError): Error {
  const result = new Error(error.message);
  result.name = error.code;
  return result;
}

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value)) return 30_000;
  return Math.max(1, Math.floor(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
