import { createHash, randomBytes, randomUUID } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
import type {
  BrowserProviderCapabilities,
  BrowserProviderControlMessage,
  BrowserProviderDescriptor,
  BrowserProviderEnrollmentResponse,
  BrowserProviderSession,
  CreateBrowserSessionRequest,
} from '@comiccrawler/browser-provider-sdk';
import type { BrowserConfig } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';

export interface ProviderRecord {
  providerId: string;
  providerName: string;
  credentialId: string;
  credentialHash: string;
  enrolledAt: string;
  lastConnectedAt?: string;
}

interface ProviderConnection {
  socket: WebSocket;
  descriptor?: BrowserProviderDescriptor;
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
  private readonly enrollmentTokens = new Map<string, number>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingTunnels = new Map<string, PendingTunnel>();
  private active?: { providerId: string; session: BrowserProviderSession };
  private relayBaseUrl = 'http://127.0.0.1:4100';

  constructor(private readonly storage?: IStorage) {}

  async initialize(): Promise<void> {
    const records = await this.storage?.read<ProviderRecord[]>(STORAGE_KEY) ?? [];
    for (const record of records) this.records.set(record.providerId, record);
  }

  setRelayBaseUrl(value: string): void {
    this.relayBaseUrl = new URL(value).href;
  }

  createEnrollmentToken(ttlSeconds = 600): { token: string; expiresAt: string } {
    const ttl = Math.min(3600, Math.max(60, Math.floor(ttlSeconds)));
    const token = `ccenroll_${randomBytes(32).toString('base64url')}`;
    const expiresAt = Date.now() + ttl * 1000;
    this.enrollmentTokens.set(hash(token), expiresAt);
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async enroll(token: string): Promise<BrowserProviderEnrollmentResponse> {
    const tokenHash = hash(token);
    const expiresAt = this.enrollmentTokens.get(tokenHash);
    this.enrollmentTokens.delete(tokenHash);
    if (!expiresAt || expiresAt <= Date.now()) throw new Error('Enrollment token is invalid or expired.');

    const providerId = `bp_${randomUUID()}`;
    const credentialId = `cred_${randomUUID()}`;
    const credential = `ccbp_${randomBytes(48).toString('base64url')}`;
    const enrolledAt = new Date().toISOString();
    this.records.set(providerId, {
      providerId,
      providerName: `Browser Provider ${providerId.slice(-6)}`,
      credentialId,
      credentialHash: hash(credential),
      enrolledAt,
    });
    await this.persist();
    return { providerId, credentialId, credential, enrolledAt };
  }

  list(): Array<Record<string, unknown>> {
    return [...this.records.values()].map((record) => ({
      providerId: record.providerId,
      providerName: record.providerName,
      enrolledAt: record.enrolledAt,
      lastConnectedAt: record.lastConnectedAt,
      online: this.connections.has(record.providerId),
      descriptor: this.connections.get(record.providerId)?.descriptor,
    }));
  }

  async removeProvider(providerId: string): Promise<void> {
    if (!this.records.has(providerId)) throw new Error(`Browser provider "${providerId}" was not found.`);
    if (this.active?.providerId === providerId) {
      throw new Error(`Browser provider "${providerId}" has an active session. Close it before removing the provider.`);
    }
    const connection = this.connections.get(providerId);
    if (connection) close(connection.socket);
    this.connections.delete(providerId);
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.providerId !== providerId) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error(`Browser provider "${providerId}" was removed.`));
      this.pendingRequests.delete(requestId);
    }
    for (const [tunnelId, pending] of this.pendingTunnels) {
      if (pending.providerId !== providerId) continue;
      clearTimeout(pending.timer);
      close(pending.browserSocket);
      this.pendingTunnels.delete(tunnelId);
    }
    this.records.delete(providerId);
    await this.persist();
  }

  authenticateCredential(credential: string | undefined): ProviderRecord | undefined {
    if (!credential) return undefined;
    const credentialHash = hash(credential);
    return [...this.records.values()].find((record) => record.credentialHash === credentialHash);
  }

  acceptControlConnection(record: ProviderRecord, socket: WebSocket): void {
    this.connections.get(record.providerId)?.socket.close(4001, 'Replaced by a new provider connection.');
    this.connections.set(record.providerId, { socket });
    socket.on('message', (data, binary) => {
      if (!binary) void this.handleControlMessage(record, socket, data.toString());
    });
    socket.on('close', () => {
      if (this.connections.get(record.providerId)?.socket === socket) this.connections.delete(record.providerId);
    });
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
    const active = this.getActiveSession();
    const expectedTicket = active ? new URL(active.connectUrl).searchParams.get('ticket') : undefined;
    if (!active || active.sessionId !== sessionId || !ticket || ticket !== expectedTicket) {
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
    const data = await this.requestProvider(providerId, { type: 'create-session', request });
    const session = data as Omit<BrowserProviderSession, 'connectUrl'>;
    const ticket = randomBytes(32).toString('base64url');
    const connectUrl = new URL(`/api/browser-providers/sessions/${encodeURIComponent(session.sessionId)}/connect`, this.relayBaseUrl);
    connectUrl.protocol = connectUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    connectUrl.searchParams.set('ticket', ticket);
    this.active = {
      providerId,
      session: { ...session, providerId, transport: 'reverse-relay', connectUrl: connectUrl.href },
    };
    return this.active.session;
  }

  async heartbeat(sessionId: string, ttlSeconds?: number): Promise<BrowserProviderSession> {
    const active = this.requireActive(sessionId);
    const data = await this.requestProvider(active.providerId, { type: 'heartbeat', sessionId, ttlSeconds });
    this.active = { providerId: active.providerId, session: { ...active.session, ...(data as object) } };
    return this.active.session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const active = this.requireActive(sessionId);
    await this.requestProvider(active.providerId, { type: 'close-session', sessionId });
    this.active = undefined;
  }

  getActiveSession(requiredCapabilities?: Partial<BrowserProviderCapabilities>): BrowserProviderSession | undefined {
    const active = this.active?.session;
    if (!active || Date.parse(active.expiresAt) <= Date.now()) {
      this.active = undefined;
      return undefined;
    }
    if (requiredCapabilities && Object.entries(requiredCapabilities).some(([key, value]) =>
      value !== undefined && active.capabilities[key as keyof BrowserProviderCapabilities] !== value)) return undefined;
    return active;
  }

  resolveBrowserConfig(base: BrowserConfig): BrowserConfig {
    const session = this.getActiveSession();
    return session ? { ...base, remote: { ...base.remote, wsEndpoint: session.connectUrl } } : base;
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
    this.pendingRequests.clear();
    this.pendingTunnels.clear();
  }

  private async handleControlMessage(record: ProviderRecord, socket: WebSocket, raw: string): Promise<void> {
    const message = JSON.parse(raw) as BrowserProviderControlMessage;
    if (message.type === 'hello') {
      if (message.descriptor.providerId !== record.providerId || message.descriptor.transports.length !== 1
        || message.descriptor.transports[0] !== 'reverse-relay') {
        socket.close(4003, 'Provider descriptor does not match enrollment.');
        return;
      }
      const connection = this.connections.get(record.providerId);
      if (connection?.socket === socket) connection.descriptor = message.descriptor;
      record.lastConnectedAt = new Date().toISOString();
      await this.persist();
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

  private requireActive(sessionId: string): { providerId: string; session: BrowserProviderSession } {
    if (!this.active || this.active.session.sessionId !== sessionId) {
      throw new Error(`Active browser session "${sessionId}" was not found.`);
    }
    return this.active;
  }

  private async persist(): Promise<void> {
    await this.storage?.write(STORAGE_KEY, [...this.records.values()]);
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
