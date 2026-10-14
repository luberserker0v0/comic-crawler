import { chromium, type BrowserServer } from 'playwright';
import type { BrowserProviderCapabilities } from './contracts';
import { BrowserProfileStrategy, type BrowserProfileHandle } from './profile-strategy';

export interface EphemeralProfileStrategyOptions {
  headless?: boolean;
  channel?: string;
}

export class EphemeralProfileStrategy extends BrowserProfileStrategy {
  readonly kind = 'ephemeral' as const;

  constructor(private readonly options: EphemeralProfileStrategyOptions = {}) {
    super();
  }

  get capabilities(): BrowserProviderCapabilities {
    const headed = this.options.headless !== true;
    return {
      browser: 'chromium',
      headed,
      interactive: headed,
      persistentContext: false,
      screenshots: true,
      downloads: true,
      tracing: true,
      fileTransfer: false,
    };
  }

  async launch(): Promise<BrowserProfileHandle> {
    const browserServer = await chromium.launchServer({
      channel: this.options.channel,
      headless: this.options.headless ?? false,
      host: '127.0.0.1',
      port: 0,
    });
    return createHandle(browserServer);
  }
}

function createHandle(browserServer: BrowserServer): BrowserProfileHandle {
  let closed = false;
  return {
    localWsEndpoint: browserServer.wsEndpoint(),
    runtimeVersion: require('playwright/package.json').version as string,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await browserServer.close();
    },
  };
}
