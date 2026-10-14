import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import { BrowserPool } from './browser-pool';
import { BrowserChallengeHandler } from '../challenge/browser-challenge-handler';
import { getGlobalVerifiedBrowserSessionRegistry } from '../challenge/verified-browser-sessions';
import { findPageHtmlInContexts, settleLazyLoadedImages } from '../challenge/remote-handoff';
import { assertNotAntiBotChallenge } from './anti-bot';
import { ComicError, ErrorType } from '../error/types';
import type { RemoteBrowserConfigResolver } from './types';

export interface HtmlRenderer {
  render(url: string): Promise<string>;
  dispose(): Promise<void>;
}

export class PlaywrightHtmlRenderer implements HtmlRenderer {
  private browserPool?: BrowserPool;
  private browserPoolEndpointKey?: string;
  private readonly challengeHandler = new BrowserChallengeHandler();

  constructor(
    private readonly browser: BrowserConfig,
    private readonly network?: NetworkConfig,
    private readonly resolveRemote?: RemoteBrowserConfigResolver
  ) {}

  async render(url: string): Promise<string> {
    const verifiedSession = getGlobalVerifiedBrowserSessionRegistry().getByUrl(url);
    if (verifiedSession) {
      try {
        const page = await findPageHtmlInContexts([verifiedSession.context], { targetUrl: url });
        assertNotAntiBotChallenge(page.html, page.url);
        return page.html;
      } catch (error) {
        throw new ComicError(
          'The previously verified browser page is no longer available. Human verification must be completed again before crawling can continue.',
          ErrorType.NETWORK_ERROR,
          true,
          {
            humanVerificationProfileUnavailable: true,
            challengeDiscoveryId: verifiedSession?.sourceJobId,
            challengeStatus: 'challenge_required',
            hostname: new URL(url).hostname,
            wsEndpoint: verifiedSession.wsEndpoint,
            cause: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    const browserPool = await this.getBrowserPool(url);
    const page = await browserPool.createPage({
      userAgent: this.network?.userAgent,
      proxy: this.network?.proxy,
    });

    try {
      await page.goto(url, {
        waitUntil: this.browser.waitUntil,
        timeout: this.browser.timeout,
      });

      if (this.browser.waitForSelector?.trim()) {
        await page.waitForSelector(this.browser.waitForSelector.trim(), {
          state: 'attached',
          timeout: this.browser.timeout,
        }).catch(async (error) => {
          const html = await page.content().catch(() => '');
          assertNotAntiBotChallenge(html, url);
          throw error;
        });
      }

      if (this.browser.postLoadDelayMs && this.browser.postLoadDelayMs > 0) {
        await page.waitForTimeout(this.browser.postLoadDelayMs);
      }

      await this.challengeHandler.ensureReady(page, url, {
        challengeAutoAttempt: this.browser.challengeAutoAttempt,
        challengeWaitMs: this.browser.challengeWaitMs,
      });
      await settleLazyLoadedImages(page, { onlyDetectedTargets: true });
      const html = await page.content();
      assertNotAntiBotChallenge(html, page.url());
      return html;
    } finally {
      await browserPool.closePage(page);
    }
  }

  async dispose(): Promise<void> {
    await this.browserPool?.dispose();
  }

  private async getBrowserPool(_url: string): Promise<BrowserPool> {
    const remote = await this.resolveRemote?.() ?? this.browser.remote;
    const endpointKey = remote?.wsEndpoint ?? '__remote_unconfigured__';

    if (this.browserPool && this.browserPoolEndpointKey === endpointKey) {
      return this.browserPool;
    }

    await this.browserPool?.dispose();
    this.browserPoolEndpointKey = endpointKey;
    this.browserPool = new BrowserPool({
      maxInstances: this.browser.maxInstances,
      timeout: this.browser.timeout,
      userAgent: this.network?.userAgent,
      proxy: this.network?.proxy,
      storageStatePath: this.browser.storageStatePath,
      remote,
    }, this.resolveRemote);
    return this.browserPool;
  }
}
