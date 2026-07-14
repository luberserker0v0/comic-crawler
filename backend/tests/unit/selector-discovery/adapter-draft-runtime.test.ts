import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';
import type { AdapterBase } from '../../../src/adapter/base';

describe('instantiateAdapterImplementationDraft', () => {
  it('loads a system-composed AdapterBase implementation draft', () => {
    const adapter = instantiateAdapterImplementationDraft(`
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
  MetadataCapability,
  ChapterImagesCapability,
} from '../../base';

export class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains = ['demo.test'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };
  readonly common = new DemoCommonCapability(this);
  readonly verification = new DemoVerificationCapability(this);
  readonly metadata = new DemoMetadataCapability(this);
  readonly chapterImages = new DemoChapterImagesCapability(this);
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'demo.test';
  }
}

class DemoVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }
}

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    return $('h1').text().trim();
  }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    return $('a[href*="/chapter-"]').map((_, element) => {
      const rawHref = $(element).attr('href') ?? '';
      const url = this.adapter.resolveUrl(sourceUrl, rawHref);
      const id = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'chapter';
      return { id, title: $(element).text().trim(), url };
    }).get();
  }
}

class DemoChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    return $('#reader img').map((_, element) => this.adapter.resolveUrl(sourceUrl, $(element).attr('src') ?? '')).get();
  }
}
`) as AdapterBase;

    const sourceUrl = 'https://demo.test/manga/title';
    const document = adapter.parseHtml('<h1>Demo Title</h1><a href="/manga/title/chapter-1">Chapter 1</a><div id="reader"><img src="/1.webp"></div>');

    expect(adapter.id).toBe('demo');
    expect(adapter.matchUrl(sourceUrl)).toBe(true);
    expect(adapter.detectVerificationRequired('<html>ok</html>')).toBe(false);
    expect(adapter.extractTitle(document, sourceUrl)).toBe('Demo Title');
    expect(adapter.extractChapterList(document, sourceUrl)).toEqual([
      { id: 'chapter-1', title: 'Chapter 1', url: 'https://demo.test/manga/title/chapter-1' },
    ]);
    expect(adapter.extractChapterImageUrls(document, sourceUrl)).toEqual(['https://demo.test/1.webp']);
  });

  it('rejects unexpected imports', () => {
    expect(() => instantiateAdapterImplementationDraft(`
const fs = require('node:fs');
export class Bad {}
`)).toThrow('not allowed');
  });
});
