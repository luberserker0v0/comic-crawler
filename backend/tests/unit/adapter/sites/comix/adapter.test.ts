import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComixAdapter } from '../../../../../src/adapter/sites/comix';
import { composeChapterImages } from '../../../../../src/adapter/runtime-composer';

const CHAPTER_URL = 'https://comix.to/title/v5rz-absolute-dominion/11497386-chapter-112';
const FIXTURE = readFileSync(join(__dirname, '../../../../fixtures/comix/chapter.html'), 'utf8');

describe('ComixAdapter', () => {
  const adapter = new ComixAdapter();

  it('matches only Comix chapter URLs', () => {
    expect(adapter.matchUrl(CHAPTER_URL)).toBe(true);
    expect(adapter.matchUrl('https://www.comix.to/title/demo/123-chapter-1')).toBe(true);
    expect(adapter.matchUrl('https://comix.to/title/v5rz-absolute-dominion')).toBe(false);
    expect(adapter.matchUrl('https://example.com/title/demo/123-chapter-1')).toBe(false);
  });

  it('declares chapter-image and human-verification capabilities only', () => {
    expect(adapter.parseMode).toBe('playwright');
    expect(adapter.capabilities).toEqual({
      verification: true,
      metadata: false,
      chapterImages: true,
    });
  });

  it('detects the Comix Cloudflare verification page', () => {
    expect(adapter.detectVerificationRequired('<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>')).toBe(true);
    expect(adapter.detectVerificationRequired('<h2>正在執行安全驗證</h2>')).toBe(true);
    expect(adapter.detectVerificationRequired('<main class="rpage-main"></main>')).toBe(false);
  });

  it('extracts the complete ordered reader image list without requiring file extensions', async () => {
    adapter.setHtmlRenderer({
      render: async () => FIXTURE,
      dispose: async () => undefined,
    });

    await expect(composeChapterImages(adapter, CHAPTER_URL)).resolves.toEqual([
      { index: 0, filename: '001.jpg', url: 'https://447.reader-one.site/hi/page-one-token' },
      { index: 1, filename: '002.jpg', url: 'https://447.reader-two.site/hi/page-two-token' },
      { index: 2, filename: '003.jpg', url: 'https://447.reader-three.site/hi/page-three-token' },
    ]);
  });

  it('rejects a partially lazy-loaded chapter instead of returning an incomplete URL list', async () => {
    adapter.setHtmlRenderer({
      render: async () => FIXTURE.replace(
        '<img class="rpage-page__img" alt="Page 3" srcset="https://447.reader-three.site/hi/page-three-token 1x">',
        '<div class="rpage-page__loader">3 / 3</div>'
      ),
      dispose: async () => undefined,
    });

    await expect(composeChapterImages(adapter, CHAPTER_URL)).rejects.toMatchObject({
      context: {
        expectedImageCount: 3,
        extractedImageCount: 2,
        lazyImagesIncomplete: true,
      },
    });
  });

  it('extracts Browser Client image annotations left by virtualized reader pages', async () => {
    const annotated = FIXTURE
      .replace(
        '<img class="rpage-page__img" alt="Page 2" data-src="https://447.reader-two.site/hi/page-two-token">',
        ''
      )
      .replace(
        '<div class="rpage-page" data-page="2">',
        '<div class="rpage-page" data-page="2" data-comiccrawler-image-url="https://447.reader-two.site/hi/page-two-token">'
      );
    adapter.setHtmlRenderer({
      render: async () => annotated,
      dispose: async () => undefined,
    });

    await expect(composeChapterImages(adapter, CHAPTER_URL)).resolves.toEqual([
      { index: 0, filename: '001.jpg', url: 'https://447.reader-one.site/hi/page-one-token' },
      { index: 1, filename: '002.jpg', url: 'https://447.reader-two.site/hi/page-two-token' },
      { index: 2, filename: '003.jpg', url: 'https://447.reader-three.site/hi/page-three-token' },
    ]);
  });
});
