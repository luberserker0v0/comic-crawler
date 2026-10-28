import type { ReaderPreparationSelectors } from './contracts';

export type BrowserScriptExecutor = <Argument, Result>(
  script: (argument: Argument) => Result | Promise<Result>,
  argument: Argument
) => Promise<Result>;

export async function prepareScrollableContent(
  execute: BrowserScriptExecutor, timeoutMs: number, reader: ReaderPreparationSelectors = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await execute(initializeScrollPreparation, reader);
  await execute(captureScrollPreparationPositions, reader);
  try {
    await execute(captureLoadedImageUrls, reader);
    const found = await prepareCandidates(execute, deadline, reader);
    if (!found && reader.pageSelector) throw new Error('Reader page selector did not match any elements.');
    if (!found) await prepareDocumentBottom(execute, deadline, reader);
  } finally {
    await finishPreparation(execute, reader);
  }
}

async function prepareCandidates(
  execute: BrowserScriptExecutor, deadline: number, reader: ReaderPreparationSelectors
): Promise<boolean> {
  let index = 0, stableChecks = 0, found = false;
  while (Date.now() < deadline) {
    const count = await execute(countScrollPreparationCandidates, reader);
    found ||= count > 0;
    if (index >= count && preparationIsStable(count, stableChecks)) return found;
    if (index >= count) {
      await execute(waitForScrollPreparation, Math.min(250, deadline - Date.now()));
      stableChecks += 1;
    } else {
      await execute(scrollPreparationCandidate, { index, waitMs: Math.min(800, deadline - Date.now()), reader });
      index += 1; stableChecks = 0;
    }
    await execute(captureLoadedImageUrls, reader);
  }
  return found;
}

function preparationIsStable(candidateCount: number, stableChecks: number): boolean {
  return stableChecks >= (candidateCount === 0 ? 8 : 3);
}

async function prepareDocumentBottom(
  execute: BrowserScriptExecutor, deadline: number, reader: ReaderPreparationSelectors
): Promise<void> {
  let done = false;
  while (!done && Date.now() < deadline) {
    const step = await execute(scrollPreparationBottomStep, reader);
    done = step.done || await execute(recordScrollPreparationBottomStep, step);
    await execute(captureLoadedImageUrls, reader);
  }
}

async function finishPreparation(
  execute: BrowserScriptExecutor, reader: ReaderPreparationSelectors
): Promise<void> {
  await execute(finishScrollPreparation, undefined);
  await execute(captureLoadedImageUrls, reader);
  await execute(clearScrollPreparation, undefined);
}

export function initializeScrollPreparation(reader: ReaderPreparationSelectors): void {
  const root = document.documentElement;
  const container = reader.containerSelector
    ? document.querySelector<HTMLElement>(reader.containerSelector) : undefined;
  if (reader.containerSelector && !container) throw new Error('Reader container selector did not match an element.');
  if (reader.pageSelector) (container ?? document).querySelector(reader.pageSelector);
  if (reader.endSelector) (container ?? document).querySelector(reader.endSelector);
  root.setAttribute('data-comiccrawler-preparation-state', JSON.stringify({ startY: window.scrollY,
    captured: {}, previousHeight: 0, previousPosition: -1, stable: 0, noProgress: 0, steps: 0 }));
}

export function captureScrollPreparationPositions(reader: ReaderPreparationSelectors): void {
  const container = reader.containerSelector ? document.querySelector<HTMLElement>(reader.containerSelector) : undefined;
  const scope = container ?? document;
  const pages = reader.pageSelector ? Array.from(scope.querySelectorAll<HTMLElement>(reader.pageSelector))
    : Array.from(scope.querySelectorAll<HTMLElement>('[data-page]'));
  const lazy = Array.from(scope.querySelectorAll<HTMLElement>(
    'img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'));
  for (const candidate of [...(pages.length > 1 ? pages : lazy), ...(container ? [container] : [])]) {
    for (let current: HTMLElement | null = candidate; current; current = current.parentElement) {
      const scrollable = current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth;
      if (!scrollable || current.hasAttribute('data-comiccrawler-scroll-position')) continue;
      current.setAttribute('data-comiccrawler-scroll-position', JSON.stringify({
        top: current.scrollTop, left: current.scrollLeft }));
    }
  }
}

export function countScrollPreparationCandidates(reader: ReaderPreparationSelectors): number {
  const scope = reader.containerSelector
    ? document.querySelector<HTMLElement>(reader.containerSelector) : document;
  if (!scope) throw new Error('Reader container selector did not match an element.');
  if (reader.pageSelector) return scope.querySelectorAll<HTMLElement>(reader.pageSelector).length;
  const pages = scope.querySelectorAll<HTMLElement>('[data-page]');
  if (pages.length > 1) return pages.length;
  return scope.querySelectorAll<HTMLElement>(
    'img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'
  ).length;
}

export async function waitForScrollPreparation(waitMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

export function captureLoadedImageUrls(reader: ReaderPreparationSelectors): void {
  const root = document.documentElement;
  const state = JSON.parse(root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as {
    captured?: Record<string, string> };
  const scope = reader.containerSelector ? document.querySelector(reader.containerSelector) : document;
  if (!scope) throw new Error('Reader container selector did not match an element.');
  const captured = state.captured ?? {};
  for (const image of Array.from(scope.querySelectorAll<HTMLImageElement>('img'))) {
    const srcset = image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    const values = [image.getAttribute('data-comiccrawler-src'), image.getAttribute('data-src'),
      image.getAttribute('data-lazy-src'), image.getAttribute('data-original'), image.currentSrc, image.src, srcset];
    const url = values.find((value) => value && !/^(?:data|blob):/i.test(value.trim()))?.trim();
    if (!url) continue;
    image.setAttribute('data-comiccrawler-src', url); const page = image.closest<HTMLElement>('[data-page]');
    const pageId = page?.getAttribute('data-page'); if (page && pageId) {
      page.setAttribute('data-comiccrawler-image-url', url); captured[pageId] = url;
    }
  }
  state.captured = captured; root.setAttribute('data-comiccrawler-preparation-state', JSON.stringify(state));
}

export async function scrollPreparationCandidate(input: {
  index: number; waitMs: number; reader: ReaderPreparationSelectors;
}): Promise<void> {
  const scope = input.reader.containerSelector
    ? document.querySelector<HTMLElement>(input.reader.containerSelector) : document;
  if (!scope) throw new Error('Reader container selector did not match an element.');
  const pages = input.reader.pageSelector
    ? Array.from(scope.querySelectorAll<HTMLElement>(input.reader.pageSelector))
    : Array.from(scope.querySelectorAll<HTMLElement>('[data-page]'));
  const lazy = Array.from(scope.querySelectorAll<HTMLElement>(
    'img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'));
  const candidates = input.reader.pageSelector || pages.length > 1 ? pages : lazy;
  candidates[input.index]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  await new Promise((resolve) => setTimeout(resolve, input.waitMs));
}

interface ScrollBottomStep { done: boolean; height: number; position: number; bottom: number }

export async function scrollPreparationBottomStep(reader: ReaderPreparationSelectors): Promise<ScrollBottomStep> {
  const root = document.documentElement;
  const container = reader.containerSelector ? document.querySelector<HTMLElement>(reader.containerSelector) : undefined;
  if (reader.containerSelector && !container) throw new Error('Reader container selector did not match an element.');
  const terminal = reader.endSelector ? (container ?? document).querySelector<HTMLElement>(reader.endSelector) : undefined;
  if (terminal && terminal.getBoundingClientRect().top <= window.innerHeight)
    return { done: true, height: 0, position: 0, bottom: 0 };
  const target = container && container.scrollHeight > container.clientHeight ? container : undefined;
  const containerBottom = container ? window.scrollY + container.getBoundingClientRect().bottom : undefined;
  const height = target?.scrollHeight ?? containerBottom ?? Math.max(document.body?.scrollHeight ?? 0, root.scrollHeight ?? 0);
  const position = target?.scrollTop ?? window.scrollY, viewport = target?.clientHeight ?? window.innerHeight;
  const bottom = Math.max(0, height - viewport);
  const next = Math.min(bottom, position + Math.max(600, Math.floor(viewport * 0.8)));
  if (target) target.scrollTo(0, next); else window.scrollTo(0, next);
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { done: false, height, position: next, bottom };
}

export function recordScrollPreparationBottomStep(step: ScrollBottomStep): boolean {
  const root = document.documentElement;
  const state = JSON.parse(root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as {
    previousHeight?: number; previousPosition?: number; stable?: number; noProgress?: number; steps?: number };
  state.stable = step.position >= step.bottom && step.height === state.previousHeight ? (state.stable ?? 0) + 1 : 0;
  state.noProgress = step.position === state.previousPosition ? (state.noProgress ?? 0) + 1 : 0;
  state.previousHeight = step.height; state.previousPosition = step.position; state.steps = (state.steps ?? 0) + 1;
  root.setAttribute('data-comiccrawler-preparation-state', JSON.stringify(state));
  return (state.stable ?? 0) >= 3 || (state.noProgress ?? 0) >= 8 || (state.steps ?? 0) >= 60;
}

export async function finishScrollPreparation(_unused: undefined): Promise<void> {
  const root = document.documentElement;
  const state = JSON.parse(root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as {
    startY?: number; captured?: Record<string, string>;
  };
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-comiccrawler-scroll-position]'))) {
    const position = JSON.parse(element.getAttribute('data-comiccrawler-scroll-position') ?? '{}') as {
      top?: number; left?: number;
    };
    element.scrollTop = position.top ?? 0;
    element.scrollLeft = position.left ?? 0;
  }
  window.scrollTo(0, state.startY ?? 0);
  for (const page of Array.from(document.querySelectorAll<HTMLElement>('[data-page]'))) {
    const url = state.captured?.[page.getAttribute('data-page') ?? ''];
    if (url) page.setAttribute('data-comiccrawler-image-url', url);
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
}

export function clearScrollPreparation(_unused: undefined): void {
  document.documentElement.removeAttribute('data-comiccrawler-preparation-state');
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-comiccrawler-scroll-position]'))) {
    element.removeAttribute('data-comiccrawler-scroll-position');
  }
}
