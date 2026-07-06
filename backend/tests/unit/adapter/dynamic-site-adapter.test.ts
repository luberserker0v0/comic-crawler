import { describe, expect, it, jest } from '@jest/globals';
import { DynamicSiteAdapter } from '../../../src/adapter/dynamic-site-adapter';
import { ComicError, ErrorType } from '../../../src/error/types';

describe('DynamicSiteAdapter capabilities', () => {
  it('rejects fetchMetadata for chapter-only adapters', async () => {
    const adapter = new DynamicSiteAdapter({
      adapterId: 'chapter-only',
      name: 'Chapter Only',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/manga/*/chapter-*'],
      capabilities: { metadata: false, chapterImages: true },
      selectors: {
        images: {
          item: '.reader img',
          srcAttr: 'src',
        },
      },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-06-25T00:00:00.000Z',
    });

    await expect(adapter.fetchMetadata('https://example.com/manga/demo')).rejects.toMatchObject({
      type: ErrorType.ADAPTER_ERROR,
      context: { adapterId: 'chapter-only', capability: 'metadata' },
    });
    await adapter.dispose();
  });

  it('extracts chapter images for chapter-only adapters', async () => {
    const adapter = new DynamicSiteAdapter({
      adapterId: 'chapter-only',
      name: 'Chapter Only',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/manga/*/chapter-*'],
      capabilities: { metadata: false, chapterImages: true },
      selectors: {
        images: {
          item: '.reader img',
          srcAttr: 'data-src',
        },
      },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-06-25T00:00:00.000Z',
    });
    (adapter as any).fetchHtml = async () => `
      <main class="reader">
        <img data-src="/images/1.webp" />
        <img data-src="https://cdn.example.com/2.webp" />
      </main>
    `;

    await expect(adapter.fetchChapterImages('https://example.com/manga/demo/chapter-1')).resolves.toEqual([
      { url: 'https://example.com/images/1.webp', index: 0 },
      { url: 'https://cdn.example.com/2.webp', index: 1 },
    ]);
    await adapter.dispose();
  });

  it('uses rendered HTML when a headless renderer is configured', async () => {
    const adapter = new DynamicSiteAdapter({
      adapterId: 'rendered-example',
      name: 'Rendered Example',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/manga/*'],
      capabilities: { metadata: false, chapterImages: true },
      selectors: {
        images: {
          item: '.reader img',
          srcAttr: 'data-src',
        },
      },
      sourceDiscoveryId: 'disc-rendered',
      promotedAt: '2026-06-26T00:00:00.000Z',
    });
    const render = jest.fn(async () => `
      <main class="reader">
        <script>document.body.dataset.rendered = "true"</script>
        <img data-src="/rendered/1.webp" />
      </main>
    `);
    adapter.setHtmlRenderer({ render, dispose: jest.fn(async () => undefined) });

    await expect(
      adapter.withHtmlFetchMode('headless', () => adapter.fetchChapterImages('https://example.com/manga/demo/chapter-1'))
    ).resolves.toEqual([
      { url: 'https://example.com/rendered/1.webp', index: 0 },
    ]);
    expect(render).toHaveBeenCalledWith('https://example.com/manga/demo/chapter-1');
    await adapter.dispose();
  });
});
