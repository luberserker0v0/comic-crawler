import type { BrowserCommand, BrowserCommandResult } from '@comiccrawler/browser-client-sdk';
import { BrowserRenderService } from '../../../src/browser/browser-render-service';
import { GatewayHtmlRenderer } from '../../../src/crawler/html-renderer';

describe('BrowserRenderService', () => {
  it('navigates, waits, and returns rendered DOM in protocol order', async () => {
    const calls: BrowserCommand[] = [];
    const results: BrowserCommandResult[] = [
      { type: 'page.get-url', url: 'about:blank' },
      { type: 'page.navigate', url: 'https://example.test/final' },
      { type: 'page.wait-for-ready', url: 'https://example.test/final' },
      { type: 'page.prepare-content', url: 'https://example.test/final' },
      { type: 'page.get-content', url: 'https://example.test/final', html: '<main>ready</main>' },
    ];
    const service = new BrowserRenderService({
      execute: async (_sessionId, command) => {
        calls.push(command);
        return results.shift()!;
      },
    });

    await expect(service.render('session-1', 'https://example.test/start', { timeoutMs: 1234 })).resolves.toEqual({
      url: 'https://example.test/final',
      html: '<main>ready</main>',
    });
    expect(calls).toEqual([
      { type: 'page.get-url' },
      { type: 'page.navigate', url: 'https://example.test/start' },
      { type: 'page.wait-for-ready', timeoutMs: 1234 },
      { type: 'page.prepare-content', strategy: 'scroll-through', timeoutMs: 987 },
      { type: 'page.get-content' },
    ]);
  });

  it('adopts a matching existing tab without navigating it', async () => {
    const calls: BrowserCommand[] = [];
    const results: BrowserCommandResult[] = [
      { type: 'page.get-url', url: 'https://example.test/chapter' },
      { type: 'page.wait-for-ready', url: 'https://example.test/chapter' },
      { type: 'page.prepare-content', url: 'https://example.test/chapter' },
      { type: 'page.get-content', url: 'https://example.test/chapter', html: '<main>ready</main>' },
    ];
    const service = new BrowserRenderService({
      claimInitialPage: () => ({
        initial: true,
        source: {
          type: 'existing-resource',
          resourceId: 'resource-1',
          expectedUrl: 'https://example.test/chapter',
          navigationPolicy: 'adopt-current-page',
        },
      }),
      execute: async (_sessionId, command) => {
        calls.push(command);
        return results.shift()!;
      },
    });

    await service.render('session-1', 'https://example.test/chapter');
    expect(calls.map((command) => command.type)).toEqual([
      'page.get-url',
      'page.wait-for-ready',
      'page.prepare-content',
      'page.get-content',
    ]);
  });

  it('rejects a result that does not match its command', async () => {
    const service = new BrowserRenderService({
      execute: async () => ({ type: 'page.focus' }),
    });
    await expect(service.currentUrl('session-1')).rejects.toThrow(
      'returned "page.focus" for command "page.get-url"'
    );
  });

  it('requires the task-bound session when used by the crawler', async () => {
    const service = new BrowserRenderService({
      execute: async () => ({ type: 'page.focus' }),
    });
    const renderer = new GatewayHtmlRenderer(service, () => undefined, {
      timeout: 30_000,
      workerWaitTimeoutMs: 30 * 60 * 1000,
      postLoadDelayMs: 0,
    });

    await expect(renderer.render('https://example.test/chapter')).rejects.toThrow(
      'Browser Worker session is required'
    );
  });
});
