export type BrowserScriptExecutor = <Argument, Result>(
  script: (argument: Argument) => Result | Promise<Result>,
  argument: Argument
) => Promise<Result>;

export async function prepareScrollableContent(execute: BrowserScriptExecutor, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await execute(initializeScrollPreparation, undefined);
  try {
    await execute(captureLoadedImageUrls, undefined);
    await prepareCandidates(execute, deadline);
    await prepareDocumentBottom(execute, deadline);
  } finally {
    await execute(finishScrollPreparation, undefined);
    await execute(captureLoadedImageUrls, undefined);
    await execute(clearScrollPreparation, undefined);
  }
}

async function prepareCandidates(
  execute: BrowserScriptExecutor,
  deadline: number
): Promise<void> {
  let index = 0;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    const count = await execute(countScrollPreparationCandidates, undefined);
    if (index >= count && preparationIsStable(index, stableChecks)) return;
    if (index >= count) {
      await execute(waitForScrollPreparation, Math.min(250, deadline - Date.now()));
      stableChecks += 1;
    } else {
      await execute(scrollPreparationCandidate, { index, waitMs: Math.min(800, deadline - Date.now()) });
      index += 1;
      stableChecks = 0;
    }
    await execute(captureLoadedImageUrls, undefined);
  }
}

function preparationIsStable(candidateCount: number, stableChecks: number): boolean {
  return stableChecks >= (candidateCount === 0 ? 8 : 3);
}

async function prepareDocumentBottom(execute: BrowserScriptExecutor, deadline: number): Promise<void> {
  let done = false;
  while (!done && Date.now() < deadline) {
    done = await execute(scrollPreparationBottomStep, undefined);
    await execute(captureLoadedImageUrls, undefined);
  }
}

export function initializeScrollPreparation(_unused: undefined): void {
  const root = document.documentElement;
  const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-page]'));
  const lazy = Array.from(document.querySelectorAll<HTMLElement>('img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'));
  const candidates = pages.length > 1 ? pages : lazy;
  root.setAttribute('data-comiccrawler-preparation-state', JSON.stringify({ startY: window.scrollY, captured: {}, previousHeight: 0, stable: 0 }));
  for (const candidate of candidates) {
    for (let current = candidate.parentElement; current; current = current.parentElement) {
      const scrollable = current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth;
      if (scrollable && !current.hasAttribute('data-comiccrawler-scroll-position')) {
        current.setAttribute('data-comiccrawler-scroll-position', JSON.stringify({ top: current.scrollTop, left: current.scrollLeft }));
      }
    }
  }
}

export function countScrollPreparationCandidates(_unused: undefined): number {
  const pages = document.querySelectorAll<HTMLElement>('[data-page]');
  if (pages.length > 1) return pages.length;
  return document.querySelectorAll<HTMLElement>(
    'img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'
  ).length;
}

export async function waitForScrollPreparation(waitMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

export function captureLoadedImageUrls(_unused: undefined): void {
  const root = document.documentElement;
  const state = JSON.parse(root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as { captured?: Record<string, string> };
  const captured = state.captured ?? {};
  for (const image of Array.from(document.querySelectorAll<HTMLImageElement>('img'))) {
    const srcset = image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    const values = [image.getAttribute('data-comiccrawler-src'), image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), image.getAttribute('data-original'), image.currentSrc, image.getAttribute('src'), srcset];
    const url = values.find((value) => value && !/^(?:data|blob):/i.test(value.trim()))?.trim();
    if (!url) continue;
    image.setAttribute('data-comiccrawler-src', url);
    const page = image.closest<HTMLElement>('[data-page]');
    const pageId = page?.getAttribute('data-page');
    if (page && pageId) { page.setAttribute('data-comiccrawler-image-url', url); captured[pageId] = url; }
  }
  state.captured = captured;
  root.setAttribute('data-comiccrawler-preparation-state', JSON.stringify(state));
}

export async function scrollPreparationCandidate(input: { index: number; waitMs: number }): Promise<void> {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-page]'));
  const lazy = Array.from(document.querySelectorAll<HTMLElement>('img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'));
  const candidates = pages.length > 1 ? pages : lazy;
  candidates[input.index]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  await new Promise((resolve) => setTimeout(resolve, input.waitMs));
}

export async function scrollPreparationBottomStep(_unused: undefined): Promise<boolean> {
  const root = document.documentElement;
  const state = JSON.parse(root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as { previousHeight?: number; stable?: number };
  const height = Math.max(document.body?.scrollHeight ?? 0, root.scrollHeight ?? 0);
  const bottom = Math.max(0, height - window.innerHeight);
  const nextY = Math.min(bottom, window.scrollY + Math.max(600, Math.floor(window.innerHeight * 0.8)));
  window.scrollTo(0, nextY);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const atBottom = window.scrollY >= bottom;
  state.stable = atBottom && height === state.previousHeight ? (state.stable ?? 0) + 1 : 0;
  state.previousHeight = height;
  root.setAttribute('data-comiccrawler-preparation-state', JSON.stringify(state));
  return state.stable >= 3;
}

export async function finishScrollPreparation(_unused: undefined): Promise<void> {
  const root = document.documentElement;
  const state = JSON.parse(root.getAttribute('data-comiccrawler-preparation-state') ?? '{}') as { startY?: number; captured?: Record<string, string> };
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-comiccrawler-scroll-position]'))) {
    const position = JSON.parse(element.getAttribute('data-comiccrawler-scroll-position') ?? '{}') as { top?: number; left?: number };
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
