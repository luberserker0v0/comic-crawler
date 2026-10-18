/**
 * Runs inside the controlled page. Keep this function self-contained so both
 * Playwright and WebExtension scripting can serialize it without closures.
 */
export async function scrollThroughDocument(timeoutMs: number): Promise<void> {
  const startY = window.scrollY;
  const deadline = Date.now() + timeoutMs;
  const capturedByPage = new Map<string, string>();
  const scrollPositions = new Map<Element, { top: number; left: number }>();
  const pageCandidates = Array.from(document.querySelectorAll<HTMLElement>('[data-page]'));
  const lazyImageCandidates = Array.from(document.querySelectorAll<HTMLElement>(
    'img[loading="lazy"], img[data-src], img[data-lazy-src], img[data-original]'
  ));
  const candidates = pageCandidates.length > 1 ? pageCandidates : lazyImageCandidates;

  const imageUrl = (image: HTMLImageElement): string | undefined => {
    const srcset = image.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
    const values = [
      image.getAttribute('data-comiccrawler-src'),
      image.getAttribute('data-src'),
      image.getAttribute('data-lazy-src'),
      image.getAttribute('data-original'),
      image.currentSrc,
      image.getAttribute('src'),
      srcset,
    ];
    return values.find((value) => {
      const normalized = value?.trim().toLowerCase();
      return normalized && !normalized.startsWith('data:') && !normalized.startsWith('blob:');
    })?.trim();
  };

  const captureLoadedImages = (): void => {
    for (const image of Array.from(document.querySelectorAll<HTMLImageElement>('img'))) {
      const url = imageUrl(image);
      if (!url) continue;
      image.setAttribute('data-comiccrawler-src', url);
      const page = image.closest<HTMLElement>('[data-page]');
      if (!page) continue;
      page.setAttribute('data-comiccrawler-image-url', url);
      const pageId = page.getAttribute('data-page');
      if (pageId) capturedByPage.set(pageId, url);
    }
  };

  const restoreCapturedPageUrls = (): void => {
    for (const page of Array.from(document.querySelectorAll<HTMLElement>('[data-page]'))) {
      const pageId = page.getAttribute('data-page');
      const url = pageId ? capturedByPage.get(pageId) : undefined;
      if (url) page.setAttribute('data-comiccrawler-image-url', url);
    }
  };

  const rememberScrollableAncestors = (element: Element): void => {
    for (let current = element.parentElement; current; current = current.parentElement) {
      if (current.scrollHeight <= current.clientHeight && current.scrollWidth <= current.clientWidth) continue;
      if (!scrollPositions.has(current)) {
        scrollPositions.set(current, { top: current.scrollTop, left: current.scrollLeft });
      }
    }
  };

  const candidateHasImageUrl = (candidate: HTMLElement): boolean => {
    if (candidate.hasAttribute('data-comiccrawler-image-url')) return true;
    if (candidate instanceof HTMLImageElement) return Boolean(imageUrl(candidate));
    return Array.from(candidate.querySelectorAll<HTMLImageElement>('img')).some((image) => Boolean(imageUrl(image)));
  };

  captureLoadedImages();
  for (const candidate of candidates) rememberScrollableAncestors(candidate);

  try {
    for (const candidate of candidates) {
      if (Date.now() >= deadline) break;
      candidate.scrollIntoView({ block: 'center', inline: 'nearest' });
      const candidateDeadline = Math.min(deadline, Date.now() + 800);
      do {
        await new Promise((resolve) => setTimeout(resolve, 100));
        captureLoadedImages();
        if (candidateHasImageUrl(candidate)) break;
      } while (Date.now() < candidateDeadline);
    }

    let previousHeight = 0;
    let stableBottomChecks = 0;
    while (Date.now() < deadline) {
      const height = Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement?.scrollHeight ?? 0
      );
      const bottom = Math.max(0, height - window.innerHeight);
      const nextY = Math.min(bottom, window.scrollY + Math.max(600, Math.floor(window.innerHeight * 0.8)));
      window.scrollTo(0, nextY);
      await new Promise((resolve) => setTimeout(resolve, 120));
      captureLoadedImages();
      const atBottom = window.scrollY >= bottom;
      stableBottomChecks = atBottom && height === previousHeight ? stableBottomChecks + 1 : 0;
      previousHeight = height;
      if (stableBottomChecks >= 3) break;
    }
  } finally {
    for (const [element, position] of scrollPositions) {
      element.scrollTop = position.top;
      element.scrollLeft = position.left;
    }
    window.scrollTo(0, startY);
    await new Promise((resolve) => setTimeout(resolve, 120));
    captureLoadedImages();
    restoreCapturedPageUrls();
  }
}
