export const BROWSER_PROVIDER_CONTRACT_VERSION = '1' as const;
export const BROWSER_PROVIDER_DISCOVERY_PATH = '/.well-known/comiccrawler-browser-provider' as const;

export type BrowserProviderProtocol = 'playwright' | 'cdp';
export type BrowserProviderTransport = 'reverse-relay';

export interface BrowserProviderCapabilities {
  browser: 'chromium' | 'firefox' | 'webkit';
  headed: boolean;
  interactive: boolean;
  persistentContext: boolean;
  screenshots: boolean;
  downloads: boolean;
  tracing: boolean;
  fileTransfer: boolean;
}

export interface BrowserProviderDescriptor {
  contractVersion: typeof BROWSER_PROVIDER_CONTRACT_VERSION;
  providerId: string;
  providerType: BrowserProviderProtocol;
  runtimeVersion: string;
  capabilities: BrowserProviderCapabilities;
  transports: BrowserProviderTransport[];
}

export interface CreateBrowserSessionRequest {
  requestedCapabilities?: Partial<BrowserProviderCapabilities>;
  ttlSeconds?: number;
}

export interface BrowserProviderSession {
  sessionId: string;
  providerId: string;
  protocol: BrowserProviderProtocol;
  transport: BrowserProviderTransport;
  connectUrl: string;
  viewerUrl?: string;
  runtimeVersion: string;
  capabilities: BrowserProviderCapabilities;
  createdAt: string;
  expiresAt: string;
}

export interface BrowserProviderSessionHandle extends Omit<BrowserProviderSession, 'connectUrl'> {
  localWsEndpoint: string;
}

export interface BrowserProviderEnrollmentResponse {
  providerId: string;
  credentialId: string;
  credential: string;
  enrolledAt: string;
}

export interface BrowserProviderServiceDiscovery {
  contractVersion: typeof BROWSER_PROVIDER_CONTRACT_VERSION;
  transport: 'reverse-relay';
  endpoints: {
    enroll: string;
    controlWebSocket: string;
    relayWebSocketTemplate: string;
  };
}

export interface BrowserProviderState {
  schemaVersion: 1;
  providerId: string;
  serverUrl: string;
  credential: {
    type: 'device-token';
    credentialId: string;
    file: string;
  };
  enrolledAt: string;
}

export type BrowserProviderControlRequest =
  | { type: 'create-session'; requestId: string; request: CreateBrowserSessionRequest }
  | { type: 'heartbeat'; requestId: string; sessionId: string; ttlSeconds?: number }
  | { type: 'close-session'; requestId: string; sessionId: string }
  | { type: 'open-tunnel'; tunnelId: string; sessionId: string; headers?: Record<string, string> };

export type BrowserProviderControlMessage =
  | { type: 'hello'; descriptor: BrowserProviderDescriptor }
  | { type: 'response'; requestId: string; ok: true; data?: unknown }
  | { type: 'response'; requestId: string; ok: false; error: string };

export interface BrowserProvider {
  describe(): Promise<BrowserProviderDescriptor>;
  createSession(request?: CreateBrowserSessionRequest): Promise<BrowserProviderSessionHandle>;
  getSession(sessionId: string): Promise<BrowserProviderSessionHandle | undefined>;
  heartbeat(sessionId: string, ttlSeconds?: number): Promise<BrowserProviderSessionHandle>;
  closeSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}
