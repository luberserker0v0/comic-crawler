import { request as httpRequest } from 'node:http';
import fastify from 'fastify';
import type { BrowserCommand, BrowserCommandResult } from '@comiccrawler/browser-client-sdk';
import { AdapterBase } from '../../src/adapter/base';
import { AdapterRegistry } from '../../src/adapter/registry';
import { BrowserRenderService } from '../../src/browser/browser-render-service';
import { setupAdaptersRoutes } from '../../src/server/routes/adapters';

describe('chapter-images request cancellation', () => {
  it('aborts active preparation and permits a replacement request', testRequestCancellation);
});

class CancellationAdapter extends AdapterBase {
  readonly id = 'request-cancellation';
  readonly name = 'Request Cancellation';
  readonly domains = ['example.test'];
  readonly parseMode = 'playwright' as const;
  override readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  override extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const src = this.asCheerio(document)('img').attr('src') ?? '';
    return [this.resolveUrl(sourceUrl, src)];
  }
}

class CancellableCommandPort {
  private blockPreparation = true;
  private readonly started = deferred<void>();
  private readonly cancelled = deferred<void>();

  waitUntilStarted(): Promise<void> { return this.started.promise; }
  waitUntilCancelled(): Promise<void> { return this.cancelled.promise; }

  async execute(
    _sessionId: string, command: BrowserCommand, _timeout?: number, signal?: AbortSignal
  ): Promise<BrowserCommandResult> {
    if (command.type === 'page.prepare.step' && this.blockPreparation)
      return this.blockUntilCancelled(signal);
    if (command.type === 'page.prepare.start')
      return { type: command.type, operationId: command.operationId, progress: progressingPreparation() };
    if (command.type === 'page.prepare.step')
      return { type: command.type, operationId: command.operationId, progress: completedPreparation() };
    if (command.type === 'page.prepare.finish')
      return { type: command.type, operationId: command.operationId, url: TARGET_URL };
    if (command.type === 'page.get-content')
      return { type: command.type, url: TARGET_URL, html: '<main><img src="/1.jpg"></main>' };
    if (command.type === 'page.focus') return { type: command.type };
    return { type: command.type, url: TARGET_URL };
  }

  private blockUntilCancelled(signal?: AbortSignal): Promise<BrowserCommandResult> {
    this.blockPreparation = false;
    this.started.resolve();
    return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => {
      this.cancelled.resolve();
      reject(signal.reason);
    }, { once: true }));
  }
}

function progressingPreparation() {
  return { status: 'progressing' as const, phase: 'candidates' as const,
    discoveredCandidates: 1, processedCandidates: 0, capturedImages: 0, fallbackSteps: 0 };
}

function completedPreparation() {
  return { ...progressingPreparation(), status: 'completed' as const,
    phase: 'completed' as const, processedCandidates: 1, capturedImages: 1 };
}

const TARGET_URL = 'https://example.test/chapter/1';

async function testRequestCancellation(): Promise<void> {
  const fixture = await createFixture();
  const pending = startChapterImagesRequest(fixture.url);
  await fixture.commands.waitUntilStarted();
  pending.destroy();
  await fixture.commands.waitUntilCancelled();
  const replacement = await fixture.app.inject({ method: 'POST', url: '/api/adapters/chapter-images',
    payload: { url: TARGET_URL } });
  expect(replacement.statusCode).toBe(200);
  expect(replacement.json().data.imageUrls).toEqual(['https://example.test/1.jpg']);
  await fixture.app.close();
}

async function createFixture() {
  const app = fastify();
  const registry = new AdapterRegistry();
  const commands = new CancellableCommandPort();
  registry.register(new CancellationAdapter());
  setupAdaptersRoutes(app, registry, { browserRenderService: new BrowserRenderService(commands),
    withBrowserSession: async (_request, _target, _url, _context, action) =>
      action('session-1', () => ({ sessionId: 'session-1', release: async () => undefined })) });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, commands, url };
}

function startChapterImagesRequest(serverUrl: string) {
  const payload = JSON.stringify({ url: TARGET_URL });
  const request = httpRequest(`${serverUrl}/api/adapters/chapter-images`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } });
  request.on('error', () => undefined);
  request.end(payload);
  return request;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: () => resolve(undefined as T) };
}
