import type { ReaderPreparationBudget, ReaderPreparationProgress,
  ReaderPreparationSelectors } from './contracts';

export type BrowserScriptExecutor = <Argument, Result>(
  script: (argument: Argument) => Result | Promise<Result>,
  argument: Argument
) => Promise<Result>;

export async function beginScrollableContentPreparation(
  execute: BrowserScriptExecutor, reader: ReaderPreparationSelectors = {}
): Promise<ScrollableContentPreparation> {
  await execute(initializeScrollPreparation, reader);
  try {
    await execute(captureScrollPreparationPositions, reader);
    const captured = await execute(captureLoadedImageUrls, reader);
    const discovered = await execute(countScrollPreparationCandidates, reader);
    return new ScrollableContentPreparation(execute, reader, discovered, captured);
  } catch (error) {
    await finishPreparation(execute, reader).catch(() => undefined);
    throw error;
  }
}

export class ScrollableContentPreparation {
  private phase: ReaderPreparationProgress['phase'] = 'candidates';
  private index = 0;
  private stableChecks = 0;
  private found = false;
  private fallbackSteps = 0;
  private closed = false;

  constructor(
    private readonly execute: BrowserScriptExecutor,
    private readonly reader: ReaderPreparationSelectors,
    private discoveredCandidates: number,
    private capturedImages: number
  ) {}

  async step(budget: ReaderPreparationBudget, signal: AbortSignal): Promise<ReaderPreparationProgress> {
    this.assertOpen();
    const deadline = Date.now() + normalizeDuration(budget.maxDurationMs);
    const actions = Math.max(1, Math.floor(budget.maxActions));
    for (let action = 0; action < actions && this.phase !== 'completed'; action += 1) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) break;
      await this.takeStep(deadline);
      signal.throwIfAborted();
    }
    return this.progress;
  }

  get progress(): ReaderPreparationProgress {
    return { status: this.phase === 'completed' ? 'completed' : 'progressing', phase: this.phase,
      discoveredCandidates: this.discoveredCandidates, processedCandidates: this.index,
      capturedImages: this.capturedImages, fallbackSteps: this.fallbackSteps };
  }

  async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await finishPreparation(this.execute, this.reader);
  }

  private async takeStep(deadline: number): Promise<void> {
    if (this.phase === 'candidates') await this.takeCandidateStep(deadline);
    else if (this.phase === 'fallback') await this.takeFallbackStep();
  }

  private async takeCandidateStep(deadline: number): Promise<void> {
    const count = await this.execute(countScrollPreparationCandidates, this.reader);
    this.discoveredCandidates = Math.max(this.discoveredCandidates, count);
    this.found ||= count > 0;
    if (this.index >= count && preparationIsStable(count, this.stableChecks)) {
      this.completeCandidatePhase(); return;
    }
    if (this.index >= count) await this.waitForCandidates(deadline);
    else await this.visitCandidate(deadline);
    this.capturedImages = await this.execute(captureLoadedImageUrls, this.reader);
  }

  private completeCandidatePhase(): void {
    if (this.found) { this.phase = 'completed'; return; }
    if (this.reader.pageSelector) throw new Error('Reader page selector did not match any elements.');
    this.phase = 'fallback';
  }

  private async waitForCandidates(deadline: number): Promise<void> {
    await this.execute(waitForScrollPreparation, Math.max(0, Math.min(250, deadline - Date.now())));
    this.stableChecks += 1;
  }

  private async visitCandidate(deadline: number): Promise<void> {
    await this.execute(scrollPreparationCandidate, { index: this.index,
      waitMs: Math.max(0, Math.min(800, deadline - Date.now())), reader: this.reader });
    this.index += 1;
    this.stableChecks = 0;
  }

  private async takeFallbackStep(): Promise<void> {
    const step = await this.execute(scrollPreparationBottomStep, this.reader);
    const done = step.done || await this.execute(recordScrollPreparationBottomStep, step);
    this.fallbackSteps += 1;
    this.capturedImages = await this.execute(captureLoadedImageUrls, this.reader);
    if (done) this.phase = 'completed';
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Reader preparation operation is closed.');
  }
}

function preparationIsStable(candidateCount: number, stableChecks: number): boolean {
  return stableChecks >= (candidateCount === 0 ? 8 : 3);
}

function normalizeDuration(value: number): number {
  if (!Number.isFinite(value)) return 2_000;
  return Math.max(1, Math.floor(value));
}

async function finishPreparation(
  execute: BrowserScriptExecutor, reader: ReaderPreparationSelectors
): Promise<void> {
  let failure: unknown;
  try { await execute(finishScrollPreparation, undefined); }
  catch (error) { failure = error; }
  try { await execute(captureLoadedImageUrls, reader); }
  catch (error) { failure ??= error; }
  try { await execute(clearScrollPreparation, undefined); }
  catch (error) { failure ??= error; }
  if (failure) throw failure;
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

export function captureLoadedImageUrls(reader: ReaderPreparationSelectors): number {
  const root = document.documentElement, state = JSON.parse(
    root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as { captured?: Record<string, string> };
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
  return Object.keys(captured).length;
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
