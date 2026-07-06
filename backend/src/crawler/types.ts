export interface BrowserPoolConfig {
  maxInstances: number;
  headless: boolean;
  timeout: number;
  userAgent?: string;
  proxy?: string;
  channel?: string;
  storageStatePath?: string;
  userDataDir?: string;
  chromiumProfileDirectory?: string;
}

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
