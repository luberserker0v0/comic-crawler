import { chromium, type Page } from 'playwright';
import type { BrowserPoolConfig, BrowserInstance, BrowserPoolStats } from './types';
import { ComicError, ErrorType } from '../error/types';

const DEFAULT_CONFIG: BrowserPoolConfig = {
  maxInstances: 3,
  headless: true,
  timeout: 30000,
};

export class BrowserPool {
  private config: BrowserPoolConfig;
  private instances = new Map<string, BrowserInstance>();
  private pageOwners = new WeakMap<Page, string>();
  private requestCount = 0;
  private isInitialized = false;

  constructor(config?: Partial<BrowserPoolConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.userDataDir && this.config.maxInstances > 1) {
      this.config.maxInstances = 1;
    }
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    for (let i = 0; i < this.config.maxInstances; i++) {
      await this.createInstance();
    }

    this.isInitialized = true;
  }

  async acquire(): Promise<BrowserInstance> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const idleInstance = this.findIdleInstance();
    if (idleInstance) {
      idleInstance.isActive = true;
      idleInstance.lastUsed = new Date();
      this.requestCount++;
      return idleInstance;
    }

    if (this.instances.size < this.config.maxInstances) {
      const newInstance = await this.createInstance();
      newInstance.isActive = true;
      newInstance.lastUsed = new Date();
      this.requestCount++;
      return newInstance;
    }

    throw new ComicError(
      'Browser pool exhausted, no available instances',
      ErrorType.NETWORK_ERROR,
      true
    );
  }

  release(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.isActive = false;
      instance.lastUsed = new Date();
    }
  }

  async createPage(options?: { userAgent?: string; proxy?: string }): Promise<Page> {
    const instance = await this.acquire();
    try {
      const initialPage = instance.page;
      const page = !initialPage.isClosed() && initialPage.url() === 'about:blank'
        ? initialPage
        : await instance.context.newPage();
      this.pageOwners.set(page, instance.id);

      if (options?.userAgent) {
        await page.setExtraHTTPHeaders({ 'User-Agent': options.userAgent });
      }

      return page;
    } catch (error) {
      this.release(instance.id);
      throw error;
    }
  }

  async closePage(page: Page): Promise<void> {
    const instance = this.findInstanceByPage(page);
    await page.close().catch(() => {});
    if (instance) {
      this.release(instance.id);
    }
  }

  getStats(): BrowserPoolStats {
    const active = Array.from(this.instances.values()).filter((i) => i.isActive).length;
    return {
      totalInstances: this.instances.size,
      activeInstances: active,
      idleInstances: this.instances.size - active,
      totalRequests: this.requestCount,
    };
  }

  async dispose(): Promise<void> {
    const promises = Array.from(this.instances.values()).map(async (instance) => {
      await instance.context.close().catch(() => {});
      await instance.browser?.close().catch(() => {});
    });

    await Promise.all(promises);
    this.instances.clear();
    this.isInitialized = false;
  }

  private async createInstance(): Promise<BrowserInstance> {
    const launchOptions = {
      headless: this.config.headless,
      channel: this.config.channel,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        ...(this.config.chromiumProfileDirectory ? [`--profile-directory=${this.config.chromiumProfileDirectory}`] : []),
      ],
    };

    const contextOptions = {
      userAgent: this.config.userAgent,
      proxy: this.config.proxy ? { server: this.config.proxy } : undefined,
      viewport: { width: 1920, height: 1080 },
      storageState: this.config.storageStatePath,
    };

    const browser = this.config.userDataDir ? undefined : await chromium.launch(launchOptions);
    const context = this.config.userDataDir
      ? await chromium.launchPersistentContext(this.config.userDataDir, {
          ...launchOptions,
          ...contextOptions,
        })
      : await browser!.newContext(contextOptions);

    const page = await context.newPage();

    const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const instance: BrowserInstance = {
      id,
      browser,
      context,
      page,
      createdAt: new Date(),
      lastUsed: new Date(),
      isActive: false,
    };

    this.instances.set(id, instance);
    return instance;
  }

  private findIdleInstance(): BrowserInstance | undefined {
    for (const instance of this.instances.values()) {
      if (!instance.isActive) {
        return instance;
      }
    }
    return undefined;
  }

  private findInstanceByPage(page: Page): BrowserInstance | undefined {
    const ownerId = this.pageOwners.get(page);
    return ownerId ? this.instances.get(ownerId) : undefined;
  }
}
