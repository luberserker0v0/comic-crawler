import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
import type {
  BrowserProviderControlMessage,
  BrowserProviderDescriptor,
  BrowserProviderRegistrationRequest,
  BrowserProviderRegistrationResponse,
  BrowserProviderSession,
  CreateBrowserSessionRequest,
} from '@comiccrawler/browser-provider-sdk';
import type { BrowserConfig } from '@comiccrawler/shared';
import type { ApiPrincipal } from '../security/api-security';
import type { IStorage } from '../storage/types';

export interface ProviderRecord {
  providerId: string;
  ownerUserId: string;
  clientInstanceId: string;
  providerName: string;
  credentialId: string;
  credentialHash: string;
  registeredAt: string;
  lastConnectedAt?: string;
  lastProcessInstanceId?: string;
  revokedAt?: string;
}

interface ProviderConnection {
  connectionId: string;
  socket: WebSocket;
  descriptor?: BrowserProviderDescriptor;
}

interface ActiveSession {
  providerId: string;
  session: BrowserProviderSession;
  ticket: string;
}

interface PendingRequest {
  providerId: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface PendingTunnel {
  providerId: string;
  browserSocket: WebSocket;
  queuedMessages: Array<{ data: RawData; binary: boolean }>;
  onMessage: (data: RawData, binary: boolean) => void;
  timer: NodeJS.Timeout;
}

const STORAGE_KEY = 'browser-providers/records';

export class BrowserProviderRegistry {
  private readonly records = new Map<string, ProviderRecord>();
  private readonly connections = new Map<string, ProviderConnection>();
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingTunnels = new Map<string, PendingTunnel>();
  private readonly changeListeners = new Set<() => void>();
  private relayBaseUrl = 'http://127.0.0.1:4100';

  constructor(private readonly storage?: IStorage) {}

  async initialize(): Promise<void> {
    const records = await this.storage?.read<ProviderRecord[]>(STORAGE_KEY) ?? [];
    for (const record of records) {
      if (!record.ownerUserId || !record.clientInstanceId || !record.registeredAt) {
        throw new Error('Legacy Browser Provider records are unsupported. Remove browser-providers/records before startup.');
      }
      this.records.set(record.providerId, record);
    }
  }

  setRelayBaseUrl(value: string): void {
    this.relayBaseUrl = new URL(value).href;
  }

  async register(
    principal: ApiPrincipal,
    request: BrowserProviderRegistrationRequest
  ): Promise<BrowserProviderRegistrationResponse> {
    const clientInstanceId = request.clientInstanceId?.trim();
    if (!clientInstanceId || clientInstanceId.length > 200) {
      throw new Error('clientInstanceId is required and must not exceed 200 characters.');
    }
    const duplicate = [...this.records.values()].find((record) =>
      !record.revokedAt
      && record.ownerUserId === principal.userId
      && record.clientInstanceId === clientInstanceId);
    if (duplicate) {
      throw new Error(`Provider instance "${clientInstanceId}" is already registered. Use its existing credential or rotate it.`);
    }
    const registeredCount = [...this.records.values()].filter((record) =>
      record.ownerUserId === principal.userId && !record.revokedAt).length;
    if (principal.limits.maxRegisteredProviders !== undefined
      && registeredCount >= principal.limits.maxRegisteredProviders) {
      throw new Error('The maximum number of registered Browser Providers has been reached.');
    }

    const providerId = `bp_${randomUUID()}`;
    const issued = issueCredential();
    const registeredAt = new Date().toISOString();
    this.records.set(providerId, {
      providerId,
      ownerUserId: principal.userId,
      clientInstanceId,
      providerName: request.providerName?.trim() || `Browser Provider ${providerId.slice(-6)}`,
      credentialId: issued.credentialId,
      credentialHash: issued.credentialHash,
      registeredAt,
    });
    await this.persist();
    this.emitChange();
    return {
      providerId,
      clientInstanceId,
      credentialId: issued.credentialId,
      credential: issued.credential,
      registeredAt,
    };
  }

  list(ownerUserId?: string): Array<Record<string, unknown>> {
    return [...this.records.values()]
      .filter((record) => ownerUserId === undefined || record.ownerUserId === ownerUserId)
      .map((record) => ({
        providerId: record.providerId,
        ownerUserId: record.ownerUserId,
        clientInstanceId: record.clientInstanceId,
        providerName: record.providerName,
        credentialId: record.credentialId,
        registeredAt: record.registeredAt,
        lastConnectedAt: record.lastConnectedAt,
        revokedAt: record.revokedAt,
        online: this.connections.has(record.providerId),
        connectionId: this.connections.get(record.providerId)?.connectionId,
        descriptor: this.connections.get(record.providerId)?.descriptor,
      }));
  }

  getRecord(providerId: string): ProviderRecord | undefined {
    return this.records.get(providerId);
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  countOnline(ownerUserId: string): number {
    return [...this.connections.keys()].filter((providerId) =>
      this.records.get(providerId)?.ownerUserId === ownerUserId).length;
  }

  isOnline(providerId: string): boolean {
    const connection = this.connections.get(providerId);
    return Boolean(connection?.descriptor && connection.socket.readyState === WebSocket.OPEN);
  }

  getProcessInstanceId(providerId: string): string | undefined {
    return this.connections.get(providerId)?.descriptor?.processInstanceId;
  }

  async revokeProvider(providerId: string): Promise<void> {
    const record = this.requireRecord(providerId);
    if (record.revokedAt) return;
    record.revokedAt = new Date().toISOString();
    this.closeProviderResources(providerId, `Browser provider "${providerId}" was revoked.`);
    await this.persist();
    this.emitChange();
  }

  async rotateCredential(providerId: string): Promise<BrowserProviderRegistrationResponse> {
    const record = this.requireRecord(providerId);
    if (record.revokedAt) throw new Error(`Browser provider "${providerId}" is revoked.`);
    const issued = issueCredential();
    record.credentialId = issued.credentialId;
    record.credentialHash = issued.credentialHash;
    this.closeProviderResources(providerId, `Browser provider "${providerId}" credential was rotated.`);
    await this.persist();
    return {
      providerId: record.providerId,
      clientInstanceId: record.clientInstanceId,
      credentialId: issued.credentialId,
      credential: issued.credential,
      registeredAt: record.registeredAt,
    };
  }

  authenticateCredential(credential: string | undefined): ProviderRecord | undefined {
    if (!credential) return undefined;
    const credentialHash = hash(credential);
    return [...this.records.values()].find((record) =>
      !record.revokedAt && secretHashEquals(record.credentialHash, credentialHash));
  }

  acceptControlConnection(record: ProviderRecord, socket: WebSocket): boolean {
    const existing = this.connections.get(record.providerId);
    if (existing && (existing.socket.readyState === WebSocket.OPEN || existing.socket.readyState === WebSocket.CONNECTING)) {
      socket.close(4009, 'Browser provider already has an active control connection.');
      return false;
    }
    const connection: ProviderConnection = { connectionId: `conn_${randomUUID()}`, socket };
    this.connections.set(record.providerId, connection);
    this.emitChange();
    socket.on('message', (data, binary) => {
      if (!binary) void this.handleControlMessage(record, socket, data.toString());
    });
    socket.on('close', () => {
      if (this.connections.get(record.providerId)?.socket === socket) {
        this.connections.delete(record.providerId);
        this.emitChange();
      }
    });
    return true;
  }

  acceptRelayConnection(record: ProviderRecord, tunnelId: string, socket: WebSocket): void {
    const pending = this.pendingTunnels.get(tunnelId);
    if (!pending || pending.providerId !== record.providerId) {
      socket.close(4004, 'Unknown relay tunnel.');
      return;
    }
    this.pendingTunnels.delete(tunnelId);
    clearTimeout(pending.timer);
    pending.browserSocket.off('message', pending.onMessage);
    bridgeWebSockets(pending.browserSocket, socket);
    for (const message of pending.queuedMessages) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message.data, { binary: message.binary });
    }
  }

  acceptBrowserConnection(
    sessionId: string,
    ticket: string | undefined,
    socket: WebSocket,
    headers?: Record<string, string>
  ): void {
    const active = this.sessions.get(sessionId);
    if (!active || Date.parse(active.session.expiresAt) <= Date.now() || !ticket
      || !secretHashEquals(hash(active.ticket), hash(ticket))) {
      socket.close(4003, 'Browser session ticket is invalid or expired.');
      return;
    }
    const connection = this.connections.get(active.providerId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      socket.close(4002, 'Browser provider is offline.');
      return;
    }
    const tunnelId = `tunnel_${randomUUID()}`;
    const timer = setTimeout(() => {
      this.pendingTunnels.delete(tunnelId);
      socket.close(4008, 'Browser provider tunnel timed out.');
    }, 15_000);
    timer.unref();
    const queuedMessages: Array<{ data: RawData; binary: boolean }> = [];
    const onMessage = (data: RawData, binary: boolean) => queuedMessages.push({ data, binary });
    socket.on('message', onMessage);
    socket.once('close', () => {
      const pending = this.pendingTunnels.get(tunnelId);
      if (!pending || pending.browserSocket !== socket) return;
      clearTimeout(pending.timer);
      this.pendingTunnels.delete(tunnelId);
    });
    this.pendingTunnels.set(tunnelId, {
      providerId: active.providerId,
      browserSocket: socket,
      queuedMessages,
      onMessage,
      timer,
    });
    connection.socket.send(JSON.stringify({ type: 'open-tunnel', tunnelId, sessionId, headers }));
  }

  async createSession(providerId: string, request: CreateBrowserSessionRequest = {}): Promise<BrowserProviderSession> {
    const record = this.requireRecord(providerId);
    if (record.revokedAt) throw new Error(`Browser provider "${providerId}" is revoked.`);
    const data = await this.requestProvider(providerId, { type: 'create-session', request });
    const session = data as Omit<BrowserProviderSession, 'connectUrl'>;
    if (!session.sessionId || this.sessions.has(session.sessionId)) throw new Error('Provider returned a duplicate or empty session ID.');
    const ticket = randomBytes(32).toString('base64url');
    const connectUrl = new URL(`/api/browser-providers/sessions/${encodeURIComponent(session.sessionId)}/connect`, this.relayBaseUrl);
    connectUrl.protocol = connectUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const active: ActiveSession = {
      providerId,
      session: { ...session, providerId, transport: 'reverse-relay', connectUrl: connectUrl.href },
      ticket,
    };
    this.sessions.set(active.session.sessionId, active);
    this.emitChange();
    return active.session;
  }

  async heartbeat(sessionId: string, ttlSeconds?: number): Promise<BrowserProviderSession> {
    const active = this.requireActive(sessionId);
    const data = await this.requestProvider(active.providerId, { type: 'heartbeat', sessionId, ttlSeconds });
    active.session = { ...active.session, ...(data as object), connectUrl: active.session.connectUrl };
    return active.session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const active = this.requireActive(sessionId);
    await this.requestProvider(active.providerId, { type: 'close-session', sessionId });
    this.sessions.delete(sessionId);
    this.emitChange();
  }

  getSession(sessionId: string): BrowserProviderSession | undefined {
    this.removeExpiredSessions();
    return this.sessions.get(sessionId)?.session;
  }

  resolveBrowserConfig(base: BrowserConfig, sessionId?: string): BrowserConfig {
    this.removeExpiredSessions();
    if (!sessionId) return base;
    const active = this.sessions.get(sessionId);
    if (!active) {
      throw new Error(`Browser session "${sessionId}" is unavailable. The task remains bound and will not switch sessions automatically.`);
    }
    return {
      ...base,
      remote: {
        ...base.remote,
        wsEndpoint: active.session.connectUrl,
        headers: {
          ...base.remote?.headers,
          'x-comiccrawler-session-ticket': active.ticket,
        },
      },
    };
  }

  dispose(): void {
    for (const connection of this.connections.values()) close(connection.socket);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Browser provider registry was stopped.'));
    }
    for (const pending of this.pendingTunnels.values()) {
      clearTimeout(pending.timer);
      close(pending.browserSocket);
    }
    this.connections.clear();
    this.sessions.clear();
    this.pendingRequests.clear();
    this.pendingTunnels.clear();
    this.changeListeners.clear();
  }

  private async handleControlMessage(record: ProviderRecord, socket: WebSocket, raw: string): Promise<void> {
    const message = JSON.parse(raw) as BrowserProviderControlMessage;
    if (message.type === 'hello') {
      if (message.descriptor.providerId !== record.providerId || !message.descriptor.processInstanceId
        || message.descriptor.transports.length !== 1
        || message.descriptor.transports[0] !== 'reverse-relay') {
        socket.close(4003, 'Provider descriptor does not match registration.');
        return;
      }
      const connection = this.connections.get(record.providerId);
      if (connection?.socket === socket) connection.descriptor = message.descriptor;
      if (record.lastProcessInstanceId && record.lastProcessInstanceId !== message.descriptor.processInstanceId) {
        for (const [sessionId, active] of this.sessions) {
          if (active.providerId === record.providerId) this.sessions.delete(sessionId);
        }
      }
      record.lastProcessInstanceId = message.descriptor.processInstanceId;
      record.lastConnectedAt = new Date().toISOString();
      await this.persist();
      this.emitChange();
      return;
    }
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending || pending.providerId !== record.providerId) return;
      this.pendingRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.error));
    }
  }

  private requestProvider(providerId: string, request: Record<string, unknown>): Promise<unknown> {
    const connection = this.connections.get(providerId);
    if (!connection?.descriptor || connection.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Browser provider "${providerId}" is offline or has not completed handshake.`));
    }
    const requestId = `req_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Browser provider request timed out: ${String(request.type)}`));
      }, 30_000);
      timer.unref();
      this.pendingRequests.set(requestId, { providerId, resolve, reject, timer });
      connection.socket.send(JSON.stringify({ ...request, requestId }));
    });
  }

  private requireRecord(providerId: string): ProviderRecord {
    const record = this.records.get(providerId);
    if (!record) throw new Error(`Browser provider "${providerId}" was not found.`);
    return record;
  }

  private requireActive(sessionId: string): ActiveSession {
    const active = this.sessions.get(sessionId);
    if (!active || Date.parse(active.session.expiresAt) <= Date.now()) {
      this.sessions.delete(sessionId);
      throw new Error(`Active browser session "${sessionId}" was not found.`);
    }
    return active;
  }

  private removeExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, active] of this.sessions) {
      if (Date.parse(active.session.expiresAt) <= now) this.sessions.delete(sessionId);
    }
  }

  private closeProviderResources(providerId: string, reason: string): void {
    const connection = this.connections.get(providerId);
    if (connection) connection.socket.close(4003, reason);
    this.connections.delete(providerId);
    for (const [sessionId, active] of this.sessions) {
      if (active.providerId === providerId) this.sessions.delete(sessionId);
    }
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.providerId !== providerId) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(requestId);
    }
    for (const [tunnelId, pending] of this.pendingTunnels) {
      if (pending.providerId !== providerId) continue;
      clearTimeout(pending.timer);
      close(pending.browserSocket);
      this.pendingTunnels.delete(tunnelId);
    }
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of [...this.changeListeners]) listener();
  }

  private async persist(): Promise<void> {
    await this.storage?.write(STORAGE_KEY, [...this.records.values()]);
  }
}

function issueCredential(): { credentialId: string; credential: string; credentialHash: string } {
  const credential = `ccbp_${randomBytes(48).toString('base64url')}`;
  return {
    credentialId: `cred_${randomUUID()}`,
    credential,
    credentialHash: hash(credential),
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function secretHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function bridgeWebSockets(left: WebSocket, right: WebSocket): void {
  left.on('message', (data, binary) => right.readyState === WebSocket.OPEN && right.send(data, { binary }));
  right.on('message', (data, binary) => left.readyState === WebSocket.OPEN && left.send(data, { binary }));
  left.on('close', () => close(right));
  right.on('close', () => close(left));
  left.on('error', () => close(right));
  right.on('error', () => close(left));
}

function close(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
}
