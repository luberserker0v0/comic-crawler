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
  it('forwards request cancellation to every browser command', BrowserRenderServiceTestForwardsCancellation);
  it('continues reader preparation across bounded progress steps', BrowserRenderServiceTestContinuesPreparation);
  it('stops reader preparation only after progress becomes idle', BrowserRenderServiceTestStopsIdlePreparation);
}

async function BrowserRenderServiceTestNavigatesWaitsAndReturnsRenderedDOMInProtocolOrder() {
    const calls: BrowserCommand[] = [];
    const service = queuedRenderService(calls, [
        { type: 'page.get-url', url: 'about:blank' },
        { type: 'page.navigate', url: 'https://example.test/final' },
        { type: 'page.wait-for-ready', url: 'https://example.test/final' },
        { type: 'page.prepare.start', operationId: 'ignored', progress: progressingPreparation() },
        { type: 'page.prepare.step', operationId: 'ignored', progress: completedPreparation() },
        { type: 'page.prepare.finish', operationId: 'ignored', url: 'https://example.test/final' },
        { type: 'page.get-content', url: 'https://example.test/final', html: '<main>ready</main>' },
    ]);
    await expect(service.render('session-1', 'https://example.test/start', { timeoutMs: 1234,
        reader: { containerSelector: '.reader', pageSelector: '.page' } })).resolves.toEqual({
        url: 'https://example.test/final',
        html: '<main>ready</main>',
    });
    expect(calls.map((command) => command.type)).toEqual(NAVIGATION_COMMAND_TYPES);
    expect(calls[3]).toEqual(expect.objectContaining({ type: 'page.prepare.start',
      strategy: 'scroll-through', reader: { containerSelector: '.reader', pageSelector: '.page' } }));
}

const NAVIGATION_COMMAND_TYPES = ['page.get-url', 'page.navigate', 'page.wait-for-ready',
  'page.prepare.start', 'page.prepare.step', 'page.prepare.finish', 'page.get-content'];

async function BrowserRenderServiceTestAdoptsAMatchingExistingTabWithoutNavigatingIt() {
    const calls: BrowserCommand[] = [];
    const service = existingTabRenderService(calls, [
        { type: 'page.get-url', url: 'https://example.test/chapter' },
        { type: 'page.wait-for-ready', url: 'https://example.test/chapter' },
        { type: 'page.prepare.start', operationId: 'ignored', progress: progressingPreparation() },
        { type: 'page.prepare.step', operationId: 'ignored', progress: completedPreparation() },
        { type: 'page.prepare.finish', operationId: 'ignored', url: 'https://example.test/chapter' },
        { type: 'page.get-content', url: 'https://example.test/chapter', html: '<main>ready</main>' },
    ]);
    await service.render('session-1', 'https://example.test/chapter');
    expect(calls.map((command) => command.type)).toEqual([
        'page.get-url', 'page.wait-for-ready', 'page.prepare.start', 'page.prepare.step',
        'page.prepare.finish', 'page.get-content',
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

async function BrowserRenderServiceTestForwardsCancellation() {
  const controller = new AbortController();
  const signals: Array<{ command: BrowserCommand['type']; signal?: AbortSignal }> = [];
  const service = new BrowserRenderService({ execute: async (_id, command, _timeout, signal) => {
    signals.push({ command: command.type, signal });
    return renderCommandResult(command);
  } });
  await service.render('session-1', 'https://example.test/chapter', { signal: controller.signal });
  expect(signals).toHaveLength(6);
  expect(signals.filter(({ command }) => command !== 'page.prepare.finish')
    .every(({ signal }) => signal === controller.signal)).toBe(true);
  expect(signals.find(({ command }) => command === 'page.prepare.finish')?.signal).toBeUndefined();
}

function renderCommandResult(command: BrowserCommand): BrowserCommandResult {
  if (command.type === 'page.get-content')
    return { type: command.type, url: 'https://example.test/chapter', html: '<main />' };
  if (command.type === 'page.focus') return { type: command.type };
  if (command.type === 'page.prepare.start' || command.type === 'page.prepare.step')
    return { type: command.type, operationId: command.operationId,
      progress: command.type === 'page.prepare.start' ? progressingPreparation() : completedPreparation() };
  if (command.type === 'page.prepare.finish')
    return { type: command.type, operationId: command.operationId, url: 'https://example.test/chapter' };
  return { type: command.type, url: 'https://example.test/chapter' };
}

function progressingPreparation() {
  return { status: 'progressing' as const, phase: 'candidates' as const,
    discoveredCandidates: 1, processedCandidates: 0, capturedImages: 0, fallbackSteps: 0 };
}

function completedPreparation() {
  return { ...progressingPreparation(), status: 'completed' as const,
    phase: 'completed' as const, processedCandidates: 1, capturedImages: 1 };
}

async function BrowserRenderServiceTestContinuesPreparation() {
  const calls: BrowserCommand[] = [];
  const results: BrowserCommandResult[] = [
    { type: 'page.get-url', url: 'https://example.test/chapter' },
    { type: 'page.wait-for-ready', url: 'https://example.test/chapter' },
    { type: 'page.prepare.start', operationId: 'ignored', progress: progressingPreparation() },
    { type: 'page.prepare.step', operationId: 'ignored', progress: advancedPreparation() },
    { type: 'page.prepare.step', operationId: 'ignored', progress: completedPreparation() },
    { type: 'page.prepare.finish', operationId: 'ignored', url: 'https://example.test/chapter' },
    { type: 'page.get-content', url: 'https://example.test/chapter', html: '<main />' },
  ];
  await queuedRenderService(calls, results).render('session-1', 'https://example.test/chapter');
  expect(calls.filter(({ type }) => type === 'page.prepare.step')).toHaveLength(2);
}

async function BrowserRenderServiceTestStopsIdlePreparation() {
  const calls: BrowserCommand[] = [];
  const service = new BrowserRenderService({ execute: async (_id, command) => {
    calls.push(command);
    if (command.type === 'page.prepare.step') await new Promise((resolve) => setTimeout(resolve, 5));
    return idlePreparationResult(command);
  } });
  await expect(service.render('session-1', 'https://example.test/chapter', { timeoutMs: 1 }))
    .rejects.toThrow('stopped making progress');
  expect(calls.at(-1)?.type).toBe('page.prepare.finish');
}

function idlePreparationResult(command: BrowserCommand): BrowserCommandResult {
  if (command.type === 'page.get-content')
    return { type: command.type, url: 'https://example.test/chapter', html: '<main />' };
  if (command.type === 'page.focus') return { type: command.type };
  if (command.type === 'page.prepare.start' || command.type === 'page.prepare.step')
    return { type: command.type, operationId: command.operationId, progress: progressingPreparation() };
  if (command.type === 'page.prepare.finish')
    return { type: command.type, operationId: command.operationId, url: 'https://example.test/chapter' };
  return { type: command.type, url: 'https://example.test/chapter' };
}

function advancedPreparation() {
  return { ...progressingPreparation(), discoveredCandidates: 2, processedCandidates: 1,
    capturedImages: 1 };
}
