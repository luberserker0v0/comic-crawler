export const BROWSER_CLIENT_PROTOCOL_VERSION = 4 as const;
export const BROWSER_CLIENT_DISCOVERY_PATH = '/.well-known/comiccrawler-browser-client' as const;

export type BrowserExecutionMode = 'existing-tab' | 'managed-profile';

export interface BrowserCapabilities {
  executionMode: BrowserExecutionMode;
  navigation: boolean;
  renderedDom: boolean;
  humanHandoff: boolean;
  responsiveViewport: boolean;
}

export interface BrowserResourceDescriptor {
  resourceId: string;
  kind: 'tab';
  url: string;
  title?: string;
}

export interface BrowserResourceRegistration extends Omit<BrowserResourceDescriptor, 'resourceId'> {
  resourceId?: string;
  localHandle?: unknown;
}

export type BrowserSessionSource =
  | {
      type: 'existing-resource';
      resourceId: string;
      expectedUrl: string;
      navigationPolicy: 'adopt-current-page';
    }
  | {
      type: 'managed-profile';
      initialUrl?: string;
      navigationPolicy: 'navigate-to-target';
    };

export interface BrowserRenderContext {
  viewport?: {
    width: number;
    height: number;
  };
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  userAgent?: string;
}

export interface ReaderPreparationSelectors {
  containerSelector?: string;
  pageSelector?: string;
  endSelector?: string;
}

export interface ReaderPreparationBudget {
  maxActions: number;
  maxDurationMs: number;
}

export interface ReaderPreparationProgress {
  status: 'progressing' | 'completed';
  phase: 'candidates' | 'fallback' | 'completed';
  discoveredCandidates: number;
  processedCandidates: number;
  capturedImages: number;
  fallbackSteps: number;
}

export interface OpenBrowserSessionRequest {
  sessionId: string;
  leaseId: string;
  source: BrowserSessionSource;
  renderContext?: BrowserRenderContext;
}

export type BrowserCommand =
  | { type: 'page.navigate'; url: string }
  | { type: 'page.get-url' }
  | { type: 'page.get-content' }
  | { type: 'page.wait-for-ready'; timeoutMs?: number }
  | { type: 'page.prepare.start'; operationId: string; strategy: 'scroll-through';
      reader?: ReaderPreparationSelectors }
  | { type: 'page.prepare.step'; operationId: string; budget: ReaderPreparationBudget }
  | { type: 'page.prepare.finish'; operationId: string }
  | { type: 'page.focus' };

export type BrowserCommandResult =
  | { type: 'page.navigate'; url: string }
  | { type: 'page.get-url'; url: string }
  | { type: 'page.get-content'; url: string; html: string }
  | { type: 'page.wait-for-ready'; url: string }
  | { type: 'page.prepare.start'; operationId: string; progress: ReaderPreparationProgress }
  | { type: 'page.prepare.step'; operationId: string; progress: ReaderPreparationProgress }
  | { type: 'page.prepare.finish'; operationId: string; url: string }
  | { type: 'page.focus' };

export type BrowserCommandErrorCode =
  | 'UNSUPPORTED_COMMAND'
  | 'INVALID_STATE'
  | 'LEASE_MISMATCH'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NAVIGATION_FAILED'
  | 'BROWSER_CLOSED'
  | 'INTERNAL_ERROR';

export interface BrowserCommandError {
  code: BrowserCommandErrorCode;
  message: string;
  retryable: boolean;
}

export interface BrowserCommandEnvelope {
  protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
  requestId: string;
  leaseId: string;
  sessionId: string;
  command: BrowserCommand;
}

export type BrowserResultEnvelope =
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      requestId: string;
      ok: true;
      result: BrowserCommandResult;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      requestId: string;
      ok: false;
      error: BrowserCommandError;
    };

export interface BrowserSession {
  readonly terminated?: Promise<void>;
  execute(command: BrowserCommand, signal: AbortSignal): Promise<BrowserCommandResult>;
  close(): Promise<void>;
}

export interface BrowserExecutor {
  describe(): Promise<BrowserCapabilities>;
  registerResource?(resource: BrowserResourceDescriptor, localHandle?: unknown): Promise<void>;
  revokeResource?(resourceId: string): Promise<void>;
  openSession(request: OpenBrowserSessionRequest, signal: AbortSignal): Promise<BrowserSession>;
  close(): Promise<void>;
}

export interface BrowserClientState {
  schemaVersion: 1;
  serverUrl: string;
  clientId: string;
  credentialId: string;
  credential: string;
  registeredAt: string;
}

export interface ClientStateStore {
  get(): Promise<BrowserClientState | undefined>;
  set(state: BrowserClientState): Promise<void>;
  clear(): Promise<void>;
}

export interface BrowserClientDiscovery {
  protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
  apiSecurityMode: 'public' | 'token';
  endpoints: {
    enroll: string;
    controlWebSocket: string;
  };
}

export interface BrowserClientEnrollmentCredentials {
  userId: string;
  userToken: string;
}

export interface BrowserClientEnrollmentRequest {
  name?: string;
  capabilities: BrowserCapabilities;
}

export interface BrowserClientEnrollmentResponse {
  clientId: string;
  credentialId: string;
  credential: string;
  registeredAt: string;
}

export interface BrowserClientConnection {
  clientId: string;
  workerId: string;
  processInstanceId: string;
}

export interface BrowserClientSocketMessageEvent {
  data: unknown;
}

export interface BrowserClientSocketCloseEvent {
  code?: number;
  reason?: string;
}

export interface BrowserClientSocket {
  readonly readyState: number;
  binaryType?: 'blob' | 'arraybuffer';
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: BrowserClientSocketMessageEvent) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: (event: BrowserClientSocketCloseEvent) => void): void;
  removeEventListener(type: 'open', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: BrowserClientSocketMessageEvent) => void): void;
  removeEventListener(type: 'error', listener: () => void): void;
  removeEventListener(type: 'close', listener: (event: BrowserClientSocketCloseEvent) => void): void;
}

export interface WebSocketFactory {
  create(url: string, protocols?: string | string[]): BrowserClientSocket;
}

export type BrowserClientToServerMessage =
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'client.authenticate';
      clientId: string;
      credential: string;
      processInstanceId: string;
      capabilities: BrowserCapabilities;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'client.heartbeat';
      workerId: string;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'resource.register';
      requestId: string;
      resource: BrowserResourceDescriptor;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'resource.revoke';
      requestId: string;
      resourceId: string;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'session.ready';
      sessionId: string;
      leaseId: string;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'session.failed';
      sessionId: string;
      leaseId: string;
      error: BrowserCommandError;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'session.closed';
      sessionId: string;
      leaseId: string;
    }
  | ({ type: 'command.result' } & BrowserResultEnvelope);

export type BrowserServerToClientMessage =
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'client.authenticated';
      workerId: string;
      heartbeatIntervalMs: number;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'client.rejected';
      reason: string;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'resource.registered';
      requestId: string;
      resource: BrowserResourceDescriptor;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'resource.revoked';
      requestId: string;
      resourceId: string;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'resource.rejected';
      requestId: string;
      error: BrowserCommandError;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'session.open';
      request: OpenBrowserSessionRequest;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'session.close';
      sessionId: string;
      leaseId: string;
    }
  | {
      protocolVersion: typeof BROWSER_CLIENT_PROTOCOL_VERSION;
      type: 'command.cancel';
      requestId: string;
      sessionId: string;
      leaseId: string;
    }
  | ({ type: 'command.execute' } & BrowserCommandEnvelope);
