import type { BrowserCommand, BrowserCommandResult } from '@comiccrawler/browser-client-sdk';
import type { BrowserSessionGateway } from './browser-session-gateway';

interface BrowserCommandPort extends Pick<BrowserSessionGateway, 'execute'> {
  claimInitialPage?(sessionId: string): ReturnType<BrowserSessionGateway['claimInitialPage']>;
}

export interface BrowserRenderOptions {
  timeoutMs?: number;
  postLoadDelayMs?: number;
}

export interface RenderedBrowserPage {
  url: string;
  html: string;
}

export class BrowserRenderService {
  constructor(private readonly gateway: BrowserCommandPort) {}

  async render(sessionId: string, url: string, options: BrowserRenderOptions = {}): Promise<RenderedBrowserPage> {
    const timeoutMs = options.timeoutMs;
    const preparationTimeoutMs = reserveCommandResponseTime(timeoutMs);
    const acquisition = this.gateway.claimInitialPage?.(sessionId) ?? {
      source: { type: 'managed-profile' as const, navigationPolicy: 'navigate-to-target' as const },
      initial: false,
    };
    const currentUrl = await this.currentUrl(sessionId);
    if (acquisition.initial && acquisition.source.type === 'existing-resource') {
      if (normalizeUrl(currentUrl) !== normalizeUrl(acquisition.source.expectedUrl)) {
        throw new Error('The registered browser tab moved away from the task URL before it was acquired.');
      }
    } else if (normalizeUrl(currentUrl) !== normalizeUrl(url)) {
      const navigation = await this.gateway.execute(sessionId, { type: 'page.navigate', url }, timeoutMs);
      assertResult(navigation, 'page.navigate');
    }
    const ready = await this.gateway.execute(
      sessionId,
      { type: 'page.wait-for-ready', timeoutMs },
      timeoutMs
    );
    assertResult(ready, 'page.wait-for-ready');
    const prepared = await this.gateway.execute(
      sessionId,
      { type: 'page.prepare-content', strategy: 'scroll-through', timeoutMs: preparationTimeoutMs },
      timeoutMs
    );
    assertResult(prepared, 'page.prepare-content');
    if (options.postLoadDelayMs && options.postLoadDelayMs > 0) {
      await delay(options.postLoadDelayMs);
    }
    const content = await this.gateway.execute(sessionId, { type: 'page.get-content' }, timeoutMs);
    assertResult(content, 'page.get-content');
    return { url: content.url, html: content.html };
  }

  async focus(sessionId: string): Promise<void> {
    const result = await this.gateway.execute(sessionId, { type: 'page.focus' });
    assertResult(result, 'page.focus');
  }

  async navigate(sessionId: string, url: string, timeoutMs?: number): Promise<string> {
    const result = await this.gateway.execute(sessionId, { type: 'page.navigate', url }, timeoutMs);
    assertResult(result, 'page.navigate');
    return result.url;
  }

  async snapshot(sessionId: string): Promise<RenderedBrowserPage> {
    const result = await this.gateway.execute(sessionId, { type: 'page.get-content' });
    assertResult(result, 'page.get-content');
    return { url: result.url, html: result.html };
  }

  async currentUrl(sessionId: string): Promise<string> {
    const result = await this.gateway.execute(sessionId, { type: 'page.get-url' });
    assertResult(result, 'page.get-url');
    return result.url;
  }
}

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}

function assertResult<T extends BrowserCommand['type']>(
  result: BrowserCommandResult,
  type: T
): asserts result is Extract<BrowserCommandResult, { type: T }> {
  if (result.type !== type) {
    throw new Error(`Browser Worker returned "${result.type}" for command "${type}".`);
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function reserveCommandResponseTime(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined) return undefined;
  return Math.max(1, Math.floor(timeoutMs * 0.8));
}
