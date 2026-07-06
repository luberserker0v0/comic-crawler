import type { BrowserConfig, NetworkConfig } from '@comiccrawler/shared';
import { BrowserPool } from './browser-pool';
import { BrowserChallengeHandler } from '../challenge/browser-challenge-handler';
import { getGlobalVerifiedBrowserSessionRegistry } from '../challenge/verified-browser-sessions';
import { findCdpPageHtml } from '../challenge/cdp-handoff';
import { assertNotAntiBotChallenge } from './anti-bot';
import { ComicError, ErrorType } from '../error/types';

export interface HtmlRenderer {
  render(url: string): Promise<string>;
  dispose(): Promise<void>;
}

export class PlaywrightHtmlRenderer implements HtmlRenderer {
  private browserPool?: BrowserPool;
  private browserPoolProfileKey?: string;
  private readonly challengeHandler = new BrowserChallengeHandler();

  constructor(
    private readonly browser: BrowserConfig,
    private readonly network?: NetworkConfig
  ) {}

  async render(url: string): Promise<string> {
    const verifiedSession = getGlobalVerifiedBrowserSessionRegistry().getByUrl(url);
    if (verifiedSession?.cdpUrl) {
      try {
        const page = await findCdpPageHtml({ cdpUrl: verifiedSession.cdpUrl, targetUrl: url });
        assertNotAntiBotChallenge(page.html, page.url);
        return page.html;
      } catch (error) {
        throw new ComicError(
          'The previously verified browser page is no longer available. Human verification must be completed again before crawling can continue.',
          ErrorType.NETWORK_ERROR,
          true,
          {
            humanVerificationProfileUnavailable: true,
            challengeDiscoveryId: verifiedSession.sourceJobId,
            challengeStatus: 'external_browser_required',
            hostname: new URL(url).hostname,
            cdpUrl: verifiedSession.cdpUrl,
            userDataDir: verifiedSession.userDataDir,
            chromiumProfileDirectory: verifiedSession.chromiumProfileDirectory,
            cause: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (verifiedSession?.userDataDir) {
      throw new ComicError(
        'Human verification must continue from the verified browser page. Reopen the verification browser for this task and complete verification; ComicCrawler will attach to that page instead of opening a new tab.',
        ErrorType.NETWORK_ERROR,
        true,
        {
          humanVerificationProfileUnavailable: true,
          challengeDiscoveryId: verifiedSession.sourceJobId,
          challengeStatus: 'external_browser_required',
          hostname: new URL(url).hostname,
          userDataDir: verifiedSession.userDataDir,
          chromiumProfileDirectory: verifiedSession.chromiumProfileDirectory,
        }
      );
    }

    let browserPool: BrowserPool;
    let page: import('playwright').Page;
    try {
      browserPool = await this.getBrowserPool(url);
      page = await browserPool.createPage({
        userAgent: this.network?.userAgent,
        proxy: this.network?.proxy,
      });
    } catch (error) {
      if (verifiedSession?.userDataDir) {
        throw new ComicError(
          'Human verification browser profile is not available yet. Close the verification browser window for that profile, then continue the task.',
          ErrorType.NETWORK_ERROR,
          true,
          {
            humanVerificationProfileUnavailable: true,
            hostname: new URL(url).hostname,
            userDataDir: verifiedSession.userDataDir,
            chromiumProfileDirectory: verifiedSession.chromiumProfileDirectory,
            challengeDiscoveryId: verifiedSession.sourceJobId,
            challengeStatus: 'ready',
            cause: error instanceof Error ? error.message : String(error),
          }
        );
      }
      throw error;
    }

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

      return (await this.challengeHandler.ensureReady(page, url, {
        challengeAutoAttempt: this.browser.challengeAutoAttempt,
        challengeWaitMs: this.browser.challengeWaitMs,
      })).html;
    } finally {
      await browserPool.closePage(page);
    }
  }

  async dispose(): Promise<void> {
    await this.browserPool?.dispose();
  }

  private async getBrowserPool(url: string): Promise<BrowserPool> {
    const verifiedSession = getGlobalVerifiedBrowserSessionRegistry().getByUrl(url);
    const userDataDir = verifiedSession?.userDataDir ?? this.browser.userDataDir;
    const chromiumProfileDirectory = verifiedSession?.chromiumProfileDirectory;
    const profileKey = `${userDataDir ?? '__ephemeral__'}::${chromiumProfileDirectory ?? ''}`;

    if (this.browserPool && this.browserPoolProfileKey === profileKey) {
      return this.browserPool;
    }

    await this.browserPool?.dispose();
    this.browserPoolProfileKey = profileKey;
      this.browserPool = new BrowserPool({
      maxInstances: userDataDir ? 1 : this.browser.maxInstances,
      headless: verifiedSession?.userDataDir ? false : this.browser.headless,
      timeout: this.browser.timeout,
      userAgent: this.network?.userAgent,
      proxy: this.network?.proxy,
      channel: this.browser.channel,
      storageStatePath: this.browser.storageStatePath,
      userDataDir,
      chromiumProfileDirectory,
    });
    return this.browserPool;
  }
}
