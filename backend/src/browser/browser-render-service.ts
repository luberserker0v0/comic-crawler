import type { BrowserCommand, BrowserCommandResult, BrowserSessionSource,
  ReaderPreparationProgress, ReaderPreparationSelectors } from '@comiccrawler/browser-client-sdk';
import { randomUUID } from 'node:crypto';
import type { BrowserSessionGateway } from './browser-session-gateway';

interface BrowserCommandPort extends Pick<BrowserSessionGateway, 'execute'> {
  claimInitialPage?(sessionId: string): ReturnType<BrowserSessionGateway['claimInitialPage']>;
}

export interface BrowserRenderOptions {
  timeoutMs?: number;
  postLoadDelayMs?: number;
  reader?: ReaderPreparationSelectors;
  signal?: AbortSignal;
}

export interface RenderedBrowserPage {
  url: string;
  html: string;
}

export class BrowserRenderService {
  constructor(private readonly gateway: BrowserCommandPort) {}

  async render(sessionId: string, url: string, options: BrowserRenderOptions = {}): Promise<RenderedBrowserPage> {
    const timeoutMs = options.timeoutMs;
    const acquisition = this.gateway.claimInitialPage?.(sessionId) ?? {
      source: { type: 'managed-profile' as const, navigationPolicy: 'navigate-to-target' as const },
      initial: false,
    };
    const currentUrl = await this.currentUrl(sessionId, options.signal);
    await this.acquirePage(sessionId, url, currentUrl, acquisition, timeoutMs, options.signal);
    await this.preparePage(sessionId, timeoutMs, options.reader, options.signal);
    if (options.postLoadDelayMs && options.postLoadDelayMs > 0)
      await delay(options.postLoadDelayMs, options.signal);
    const content = await this.gateway.execute(
      sessionId, { type: 'page.get-content' }, timeoutMs, options.signal);
    assertResult(content, 'page.get-content');
    return { url: content.url, html: content.html };
  }

  private async acquirePage(sessionId: string, url: string, currentUrl: string,
    acquisition: { source: BrowserSessionSource; initial: boolean }, timeoutMs?: number,
    signal?: AbortSignal): Promise<void> {
    if (acquisition.initial && acquisition.source.type === 'existing-resource') {
      if (normalizeUrl(currentUrl) !== normalizeUrl(acquisition.source.expectedUrl)) {
        throw new Error('The registered browser tab moved away from the task URL before it was acquired.');
      }
      return;
    }
    if (normalizeUrl(currentUrl) === normalizeUrl(url)) return;
    const result = await this.gateway.execute(sessionId, { type: 'page.navigate', url }, timeoutMs, signal);
    assertResult(result, 'page.navigate');
  }

  private async preparePage(
    sessionId: string, timeoutMs?: number, reader?: ReaderPreparationSelectors, signal?: AbortSignal
  ): Promise<void> {
    const ready = await this.gateway.execute(
      sessionId, { type: 'page.wait-for-ready', timeoutMs }, timeoutMs, signal);
    assertResult(ready, 'page.wait-for-ready');
    await new ReaderPreparationRunner(this.gateway, sessionId, timeoutMs, reader, signal).run();
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

  async currentUrl(sessionId: string, signal?: AbortSignal): Promise<string> {
    const result = await this.gateway.execute(sessionId, { type: 'page.get-url' }, undefined, signal);
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

function delay(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

class ReaderPreparationRunner {
  private readonly operationId = `prep_${randomUUID()}`;
  private readonly noProgressTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private started = false;

  constructor(private readonly gateway: BrowserCommandPort, private readonly sessionId: string,
    timeoutMs: number | undefined, private readonly reader: ReaderPreparationSelectors | undefined,
    private readonly signal: AbortSignal | undefined) {
    this.noProgressTimeoutMs = normalizePreparationTimeout(timeoutMs);
    this.commandTimeoutMs = Math.min(this.noProgressTimeoutMs, 10_000);
  }

  async run(): Promise<void> {
    let succeeded = false;
    try {
      const progress = await this.start();
      this.started = true;
      await this.continue(progress);
      succeeded = true;
    } finally {
      if (this.started) await this.finish(succeeded);
    }
  }

  private async start(): Promise<ReaderPreparationProgress> {
    const result = await this.gateway.execute(this.sessionId, { type: 'page.prepare.start',
      operationId: this.operationId, strategy: 'scroll-through', reader: this.reader },
    this.commandTimeoutMs, this.signal);
    assertResult(result, 'page.prepare.start');
    return result.progress;
  }

  private async continue(initial: ReaderPreparationProgress): Promise<void> {
    let progress = initial, previous = initial, lastProgressAt = Date.now();
    const deadline = Date.now() + 30 * 60 * 1000;
    while (progress.status !== 'completed') {
      this.signal?.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('Reader preparation exceeded its operation deadline.');
      progress = await this.step();
      if (madeProgress(previous, progress)) lastProgressAt = Date.now();
      if (Date.now() - lastProgressAt >= this.noProgressTimeoutMs)
        throw new Error('Reader preparation stopped making progress.');
      previous = progress;
    }
  }

  private async step(): Promise<ReaderPreparationProgress> {
    const result = await this.gateway.execute(this.sessionId, { type: 'page.prepare.step',
      operationId: this.operationId, budget: { maxActions: 4, maxDurationMs: 2_000 } },
    this.commandTimeoutMs, this.signal);
    assertResult(result, 'page.prepare.step');
    return result.progress;
  }

  private async finish(succeeded: boolean): Promise<void> {
    try {
      const result = await this.gateway.execute(this.sessionId, {
        type: 'page.prepare.finish', operationId: this.operationId }, this.commandTimeoutMs);
      assertResult(result, 'page.prepare.finish');
    } catch (error) {
      if (succeeded) throw error;
    }
  }
}

function madeProgress(previous: ReaderPreparationProgress, next: ReaderPreparationProgress): boolean {
  return previous.phase !== next.phase
    || previous.discoveredCandidates !== next.discoveredCandidates
    || previous.processedCandidates !== next.processedCandidates
    || previous.capturedImages !== next.capturedImages
    || previous.fallbackSteps !== next.fallbackSteps;
}

function normalizePreparationTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 30_000;
  return Math.max(1, Math.floor(value));
}
