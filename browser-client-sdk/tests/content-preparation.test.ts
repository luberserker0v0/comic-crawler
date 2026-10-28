import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finishScrollPreparation,
  prepareScrollableContent,
  recordScrollPreparationBottomStep,
} from '../src';

test('reader preparation follows dynamic pages without entering infinite comments', testDynamicReaderBoundary);
test('document fallback stops after its fixed step budget', testFallbackStepBudget);
test('successful preparation restores window and nested scroll positions', testCompletedRestoration);

async function testDynamicReaderBoundary(): Promise<void> {
  const fixture = createDynamicReaderExecutor();
  await prepareScrollableContent(fixture.execute, 2_000, {
    containerSelector: '.reader', pageSelector: '.page', endSelector: '.reader-end',
  });
  assert.deepEqual(fixture.candidates, [0, 1, 2]);
  assert.equal(fixture.bottomSteps, 0);
  assert.ok(fixture.calls.includes('finishScrollPreparation'));
  assert.ok(fixture.calls.includes('clearScrollPreparation'));
}

function createDynamicReaderExecutor() {
  const calls: string[] = [], candidates: number[] = [];
  let countChecks = 0, bottomSteps = 0;
  const execute = async <Argument, Result>(
    script: (argument: Argument) => Result | Promise<Result>, argument: Argument
  ): Promise<Result> => {
    calls.push(script.name);
    if (script.name === 'countScrollPreparationCandidates')
      return Math.min(++countChecks, 3) as Result;
    if (script.name === 'scrollPreparationCandidate')
      candidates.push((argument as { index: number }).index);
    if (script.name === 'scrollPreparationBottomStep') bottomSteps += 1;
    return undefined as Result;
  };
  return { calls, candidates, get bottomSteps() { return bottomSteps; }, execute };
}

function testFallbackStepBudget(): void {
  const root = createAttributeElement({
    'data-comiccrawler-preparation-state': JSON.stringify({
      previousHeight: 0, previousPosition: -1, stable: 0, noProgress: 0, steps: 0,
    }),
  });
  withBrowserGlobals({ document: { documentElement: root } }, () => {
    for (let index = 1; index < 60; index += 1)
      assert.equal(recordScrollPreparationBottomStep(growingStep(index)), false);
    assert.equal(recordScrollPreparationBottomStep(growingStep(60)), true);
  });
}

function growingStep(index: number) {
  return { done: false, height: 1_000 + index * 100, position: index * 100, bottom: index * 100 + 50 };
}

async function testCompletedRestoration(): Promise<void> {
  const nested = createScrollElement(42, 7);
  const page = createAttributeElement({ 'data-page': '1' });
  const root = createAttributeElement({
    'data-comiccrawler-preparation-state': JSON.stringify({ startY: 321, captured: { 1: 'https://img/1.jpg' } }),
  });
  const document = createRestorationDocument(root, nested, page);
  const restoredWindow: number[] = [];
  await withBrowserGlobals({ document, window: { scrollTo: (_x: number, y: number) => restoredWindow.push(y) } },
    () => finishScrollPreparation(undefined));
  assert.deepEqual([nested.scrollTop, nested.scrollLeft], [42, 7]);
  assert.deepEqual(restoredWindow, [321]);
  assert.equal(page.getAttribute('data-comiccrawler-image-url'), 'https://img/1.jpg');
}

function createScrollElement(top: number, left: number) {
  const element = createAttributeElement({
    'data-comiccrawler-scroll-position': JSON.stringify({ top, left }),
  });
  return Object.assign(element, { scrollTop: 0, scrollLeft: 0 });
}

function createRestorationDocument(root: AttributeElement, nested: AttributeElement, page: AttributeElement) {
  return {
    documentElement: root,
    querySelectorAll(selector: string) {
      return selector === '[data-comiccrawler-scroll-position]' ? [nested] : [page];
    },
  };
}

interface AttributeElement {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  scrollTop?: number;
  scrollLeft?: number;
}

function createAttributeElement(initial: Record<string, string>): AttributeElement {
  const attributes = new Map(Object.entries(initial));
  return {
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
  };
}

async function withBrowserGlobals<Result>(
  values: { document: unknown; window?: unknown }, operation: () => Result | Promise<Result>
): Promise<Result> {
  const previous = { document: globalThis.document, window: globalThis.window };
  Object.assign(globalThis, values);
  try {
    return await operation();
  } finally {
    Object.assign(globalThis, previous);
  }
}
