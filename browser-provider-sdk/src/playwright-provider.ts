import { randomUUID } from 'node:crypto';
import {
  BROWSER_PROVIDER_CONTRACT_VERSION,
  type BrowserProvider,
  type BrowserProviderCapabilities,
  type BrowserProviderDescriptor,
  type BrowserProviderSessionHandle,
  type CreateBrowserSessionRequest,
} from './contracts';
import { EphemeralProfileStrategy } from './ephemeral-profile-strategy';
import { BrowserProfileStrategy, type BrowserProfileHandle } from './profile-strategy';

export interface PlaywrightBrowserProviderOptions {
  providerId?: string;
  headless?: boolean;
  channel?: string;
  defaultTtlSeconds?: number;
  maxSessions?: number;
  profileStrategy?: BrowserProfileStrategy;
}

interface ActiveSession {
  handle: BrowserProviderSessionHandle;
  profileHandle: BrowserProfileHandle;
  expiryTimer: NodeJS.Timeout;
}

export class PlaywrightBrowserProvider implements BrowserProvider {
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly profileStrategy: BrowserProfileStrategy;

  constructor(private readonly options: PlaywrightBrowserProviderOptions = {}) {
    this.profileStrategy = options.profileStrategy ?? new EphemeralProfileStrategy({
      channel: options.channel,
      headless: options.headless,
    });
  }

  async describe(): Promise<BrowserProviderDescriptor> {
    return {
      contractVersion: BROWSER_PROVIDER_CONTRACT_VERSION,
      providerId: this.options.providerId ?? 'local-playwright',
      providerType: 'playwright',
      runtimeVersion: require('playwright/package.json').version as string,
      capabilities: this.profileStrategy.capabilities,
      transports: ['reverse-relay'],
    };
  }

  async createSession(request: CreateBrowserSessionRequest = {}): Promise<BrowserProviderSessionHandle> {
    this.removeExpiredSessions();
    const maxSessions = this.options.maxSessions ?? 2;
    if (this.sessions.size >= maxSessions) {
      throw new Error(`Browser provider session limit reached (${maxSessions}).`);
    }
    const capabilities = this.profileStrategy.capabilities;
    assertCapabilities(capabilities, request.requestedCapabilities);

    const profileHandle = await this.profileStrategy.launch();
    const descriptor = await this.describe();
    const sessionId = `bps_${randomUUID()}`;
    const ttlSeconds = normalizeTtl(request.ttlSeconds ?? this.options.defaultTtlSeconds);
    const now = Date.now();
    const handle: BrowserProviderSessionHandle = {
      sessionId,
      providerId: descriptor.providerId,
      protocol: 'playwright',
      transport: 'reverse-relay',
      localWsEndpoint: profileHandle.localWsEndpoint,
      runtimeVersion: profileHandle.runtimeVersion,
      capabilities,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    };
    const expiryTimer = setTimeout(() => void this.closeSession(sessionId), ttlSeconds * 1000);
    expiryTimer.unref();
    this.sessions.set(sessionId, { handle, profileHandle, expiryTimer });
    return handle;
  }

  async getSession(sessionId: string): Promise<BrowserProviderSessionHandle | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (Date.parse(session.handle.expiresAt) <= Date.now()) {
      await this.closeSession(sessionId);
      return undefined;
    }
    return session.handle;
  }

  async heartbeat(sessionId: string, ttlSeconds?: number): Promise<BrowserProviderSessionHandle> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Browser session "${sessionId}" was not found.`);
    clearTimeout(session.expiryTimer);
    const ttl = normalizeTtl(ttlSeconds ?? this.options.defaultTtlSeconds);
    session.handle = {
      ...session.handle,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
    session.expiryTimer = setTimeout(() => void this.closeSession(sessionId), ttl * 1000);
    session.expiryTimer.unref();
    return session.handle;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    clearTimeout(session.expiryTimer);
    await this.profileStrategy.close(session.profileHandle).catch(() => undefined);
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.closeSession(sessionId)));
  }

  private removeExpiredSessions(): void {
    for (const [sessionId, session] of this.sessions) {
      if (Date.parse(session.handle.expiresAt) <= Date.now()) {
        void this.closeSession(sessionId);
      }
    }
  }
}

function normalizeTtl(value = 300): number {
  if (!Number.isFinite(value)) return 300;
  return Math.min(3600, Math.max(30, Math.floor(value)));
}

function assertCapabilities(
  available: BrowserProviderCapabilities,
  requested: Partial<BrowserProviderCapabilities> | undefined
): void {
  if (!requested) return;
  for (const [key, value] of Object.entries(requested)) {
    if (value !== undefined && available[key as keyof BrowserProviderCapabilities] !== value) {
      throw new Error(`Browser provider does not satisfy requested capability "${key}".`);
    }
  }
}
