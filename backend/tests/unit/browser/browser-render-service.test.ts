import type { BrowserCommand, BrowserCommandResult } from '@comiccrawler/browser-client-sdk';
import { BrowserRenderService } from '../../../src/browser/browser-render-service';
import { GatewayHtmlRenderer } from '../../../src/crawler/html-renderer';

describe('BrowserRenderService', () => {
  BrowserRenderServiceTestGroup1();
});

function BrowserRenderServiceTestGroup1(): void {
  it('navigates, waits, and returns rendered DOM in protocol order', BrowserRenderServiceTestNavigatesWaitsAndReturnsRenderedDOMInProtocolOrder);
  it('adopts a matching existing tab without navigating it', BrowserRenderServiceTestAdoptsAMatchingExistingTabWithoutNavigatingIt);
  it('rejects a result that does not match its command', BrowserRenderServiceTestRejectsAResultThatDoesNotMatchItsCommand);
  it('requires the task-bound session when used by the crawler', BrowserRenderServiceTestRequiresTheTaskBoundSessionWhenUsedByTheCrawler);
}

async function BrowserRenderServiceTestNavigatesWaitsAndReturnsRenderedDOMInProtocolOrder() {
    const calls: BrowserCommand[] = [];
    const service = queuedRenderService(calls, [
        { type: 'page.get-url', url: 'about:blank' },
        { type: 'page.navigate', url: 'https://example.test/final' },
        { type: 'page.wait-for-ready', url: 'https://example.test/final' },
        { type: 'page.prepare-content', url: 'https://example.test/final' },
        { type: 'page.get-content', url: 'https://example.test/final', html: '<main>ready</main>' },
    ]);
    await expect(service.render('session-1', 'https://example.test/start', { timeoutMs: 1234 })).resolves.toEqual({
        url: 'https://example.test/final',
        html: '<main>ready</main>',
    });
    expect(calls).toEqual(NAVIGATION_COMMANDS);
}

const NAVIGATION_COMMANDS: BrowserCommand[] = [
  { type: 'page.get-url' },
  { type: 'page.navigate', url: 'https://example.test/start' },
  { type: 'page.wait-for-ready', timeoutMs: 1234 },
  { type: 'page.prepare-content', strategy: 'scroll-through', timeoutMs: 987 },
  { type: 'page.get-content' },
];

async function BrowserRenderServiceTestAdoptsAMatchingExistingTabWithoutNavigatingIt() {
    const calls: BrowserCommand[] = [];
    const service = existingTabRenderService(calls, [
        { type: 'page.get-url', url: 'https://example.test/chapter' },
        { type: 'page.wait-for-ready', url: 'https://example.test/chapter' },
        { type: 'page.prepare-content', url: 'https://example.test/chapter' },
        { type: 'page.get-content', url: 'https://example.test/chapter', html: '<main>ready</main>' },
    ]);
    await service.render('session-1', 'https://example.test/chapter');
    expect(calls.map((command) => command.type)).toEqual([
        'page.get-url', 'page.wait-for-ready', 'page.prepare-content', 'page.get-content',
    ]);
}

function existingTabRenderService(calls: BrowserCommand[], results: BrowserCommandResult[]) {
  return queuedRenderService(calls, results, {
    claimInitialPage: () => ({
            initial: true,
            source: {
                type: 'existing-resource',
                resourceId: 'resource-1',
                expectedUrl: 'https://example.test/chapter',
                navigationPolicy: 'adopt-current-page',
            },
    }),
  });
}

function queuedRenderService(calls: BrowserCommand[], results: BrowserCommandResult[], options = {}) {
  return new BrowserRenderService({
    ...options,
    execute: async (_sessionId, command) => {
      calls.push(command);
      return results.shift()!;
    },
  });
}

async function BrowserRenderServiceTestRejectsAResultThatDoesNotMatchItsCommand() {
    const service = new BrowserRenderService({
        execute: async () => ({ type: 'page.focus' }),
    });
    await expect(service.currentUrl('session-1')).rejects.toThrow('returned "page.focus" for command "page.get-url"');
}

async function BrowserRenderServiceTestRequiresTheTaskBoundSessionWhenUsedByTheCrawler() {
    const service = new BrowserRenderService({
        execute: async () => ({ type: 'page.focus' }),
    });
    const renderer = new GatewayHtmlRenderer(service, () => undefined, {
        timeout: 30000,
        workerWaitTimeoutMs: 30 * 60 * 1000,
        postLoadDelayMs: 0,
    });
    await expect(renderer.render('https://example.test/chapter')).rejects.toThrow('Browser Worker session is required');
}
