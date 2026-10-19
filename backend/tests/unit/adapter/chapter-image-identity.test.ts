import { describe, expect, it } from '@jest/globals';
import type { ChapterImageIdentityStrategyContract, IComicAdapter } from '@comiccrawler/shared';
import { createChapterImageIdentities } from '../../../src/adapter/chapter-image-identity';

function adapter(strategy?: ChapterImageIdentityStrategyContract): IComicAdapter {
  return {
    id: 'identity-demo',
    name: 'Identity Demo',
    domains: ['reader.example'],
    parseMode: 'playwright',
    matchUrl: () => true,
    chapterImageIdentity: strategy,
  };
}

const chapterUrl = 'https://reader.example/title/demo/chapter-1?token=old#reader';

function identities(imageUrls: string[], strategy?: ChapterImageIdentityStrategyContract) {
  return createChapterImageIdentities({ adapter: adapter(strategy), chapterUrl, imageUrls });
}

describe('chapter image identity', () => {
  it('returns the same deterministic chapter and page IDs for unchanged input', () => {
    const first = identities(['https://cdn-a.example/pages/1.jpg?token=old', 'https://cdn-a.example/pages/2.jpg?token=old']);
    const second = identities(['https://cdn-a.example/pages/1.jpg?token=old', 'https://cdn-a.example/pages/2.jpg?token=old']);

    expect(second).toEqual(first);
    expect(first.chapter).toMatchObject({
      canonicalUrl: 'https://reader.example/title/demo/chapter-1',
      stability: 'deterministic',
      identitySource: 'normalized-url',
    });
  });

  it('preserves page IDs across reorder, insertion, and removal while updating orderIndex', () => {
    const first = identities([
      'https://cdn.example/pages/1.jpg',
      'https://cdn.example/pages/2.jpg',
      'https://cdn.example/pages/3.jpg',
    ]);
    const changed = identities([
      'https://cdn.example/pages/new.jpg',
      'https://cdn.example/pages/3.jpg',
      'https://cdn.example/pages/1.jpg',
    ]);
    const firstByUrl = new Map(first.images.map((image) => [image.url, image.id]));

    expect(changed.images[1]).toMatchObject({ id: firstByUrl.get('https://cdn.example/pages/3.jpg'), orderIndex: 1 });
    expect(changed.images[2]).toMatchObject({ id: firstByUrl.get('https://cdn.example/pages/1.jpg'), orderIndex: 2 });
    expect(changed.images.map((image) => image.id)).not.toContain(firstByUrl.get('https://cdn.example/pages/2.jpg'));
  });

  it('ignores CDN host rotation and volatile signed query parameters', () => {
    const first = identities(['https://cdn-a.example/pages/1.jpg?token=old&width=1200']);
    const renewed = identities(['https://cdn-b.example/pages/1.jpg?token=new&width=1200&expires=999']);

    expect(renewed.images[0]?.id).toBe(first.images[0]?.id);
  });

  it('assigns a new ID when the normalized source key changes', () => {
    const first = identities(['https://cdn.example/pages/source-v1.jpg?token=old']);
    const replaced = identities(['https://cdn.example/pages/source-v2.jpg?token=new']);

    expect(replaced.images[0]?.id).not.toBe(first.images[0]?.id);
  });

  it('keeps an adapter-owned page ID while reporting a changed source fingerprint', () => {
    const strategy: ChapterImageIdentityStrategyContract = {
      identifyChapter: ({ document }) => ({
        canonicalUrl: 'https://reader.example/title/demo/chapter-1',
        sourceKey: (document as { chapterKey: string }).chapterKey,
      }),
      identifyPage: ({ document }) => ({
        sourceKey: 'site-page-42',
        sourceFingerprint: (document as { fingerprint: string }).fingerprint,
      }),
    };
    const first = createChapterImageIdentities({
      adapter: adapter(strategy),
      chapterUrl,
      imageUrls: ['https://cdn.example/old.jpg'],
      document: { chapterKey: 'site-chapter-7', fingerprint: 'sha256:first' },
    });
    const replaced = createChapterImageIdentities({
      adapter: adapter(strategy),
      chapterUrl,
      imageUrls: ['https://cdn.example/new.jpg'],
      document: { chapterKey: 'site-chapter-7', fingerprint: 'sha256:second' },
    });

    expect(replaced.images[0]?.id).toBe(first.images[0]?.id);
    expect(replaced.images[0]?.sourceFingerprint).toBe('sha256:second');
    expect(replaced.chapter.identitySource).toBe('adapter');
  });

  it('returns opaque IDs that do not expose URLs or local handles', () => {
    const result = identities(['https://cdn.example/private/path/page-1.jpg?token=secret']);

    expect(result.chapter.id).toMatch(/^chapter_[A-Za-z0-9_-]{24}$/);
    expect(result.images[0]?.id).toMatch(/^page_[A-Za-z0-9_-]{24}$/);
    expect(result.chapter.id).not.toContain('reader');
    expect(result.images[0]?.id).not.toContain('page-1');
  });

  it('scopes chapter IDs to the adapter and page IDs to the chapter', () => {
    const imageUrls = ['https://cdn.example/pages/shared.jpg'];
    const first = createChapterImageIdentities({ adapter: adapter(), chapterUrl: 'https://reader.example/chapter/1', imageUrls });
    const otherChapter = createChapterImageIdentities({ adapter: adapter(), chapterUrl: 'https://reader.example/chapter/2', imageUrls });
    const otherAdapter = createChapterImageIdentities({
      adapter: { ...adapter(), id: 'other-adapter' },
      chapterUrl: 'https://reader.example/chapter/1',
      imageUrls,
    });

    expect(otherChapter.chapter.id).not.toBe(first.chapter.id);
    expect(otherChapter.images[0]?.id).not.toBe(first.images[0]?.id);
    expect(otherAdapter.chapter.id).not.toBe(first.chapter.id);
  });
});
