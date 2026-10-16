export interface BrowserPoolConfig {
  maxInstances: number;
  timeout: number;
  userAgent?: string;
  proxy?: string;
  remote?: {
    wsEndpoint?: string;
    connectTimeout?: number;
    exposeNetwork?: string;
    headers?: Record<string, string>;
  };
}

export type RemoteBrowserConfigResolver = (sessionId?: string) => Promise<BrowserPoolConfig['remote'] | undefined>;

export interface BrowserInstance {
  id: string;
  browser?: import('playwright').Browser;
  context: import('playwright').BrowserContext;
  page: import('playwright').Page;
  createdAt: Date;
  lastUsed: Date;
  isActive: boolean;
}

export interface BrowserPoolStats {
  totalInstances: number;
  activeInstances: number;
  idleInstances: number;
  totalRequests: number;
}
