import { describe, expect, it } from '@jest/globals';
import { validateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-implementation';

const VALID_CHAPTER_ONLY_ADAPTER = `
import { AdapterBase, ChapterImagesCapability, CommonCapability } from '../adapter/base';

export class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: false, metadata: false, chapterImages: true };
  readonly common = new DemoCommonCapability(this);
  readonly chapterImages = new DemoChapterImagesCapability(this);
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }
}

class DemoChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    return $('.reader img').map((_, image) => this.adapter.resolveUrl(sourceUrl, $(image).attr('src') ?? '')).get();
  }
}
`;

describe('validateAdapterImplementationDraft', () => {
  it('accepts an AdapterBase TypeScript implementation draft', () => {
    const result = validateAdapterImplementationDraft(VALID_CHAPTER_ONLY_ADAPTER, { target: 'chapter-only' });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.syntaxValid).toBe(true);
  });

  it('rejects drafts that do not extend AdapterBase', () => {
    const result = validateAdapterImplementationDraft('export class Demo {}', { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Implementation must export a class that extends AdapterBase.');
  });

  it('rejects forbidden runtime APIs', () => {
    const result = validateAdapterImplementationDraft(`${VALID_CHAPTER_ONLY_ADAPTER}\nprocess.exit(1);`, { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Direct process access is not allowed.');
  });

  it('rejects filesystem subpath imports', () => {
    const result = validateAdapterImplementationDraft(
      `import { readFile } from 'node:fs/promises';\n${VALID_CHAPTER_ONLY_ADAPTER}`,
      { target: 'chapter-only' }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Filesystem imports are not allowed.');
  });

  it('rejects old adapter facade functions', () => {
    const result = validateAdapterImplementationDraft(`${VALID_CHAPTER_ONLY_ADAPTER}
export function fetchMetadata() {
  return undefined;
}
`, { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Implementation must not mention old facade functions fetchMetadata or fetchChapterImages.');
  });

  it('rejects non-AdapterBase DOM APIs and constructor identity objects', () => {
    const result = validateAdapterImplementationDraft(`
import { AdapterBase, Capability } from 'comiccrawler';

export class BadAdapter extends AdapterBase {
  readonly id = 'bad';
  readonly name = 'Bad';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: false, metadata: false, chapterImages: true };
  constructor() {
    super({ id: 'bad' });
  }
  extractChapterImageUrls(): string[] {
    return this.dom.select('img').map((image: any) => image.attr('src'));
  }
}
`, { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Generic Capability imports/usages are not part of the AdapterBase contract.');
    expect(result.errors).toContain('Importing from "comiccrawler" is not valid in adapter implementation drafts.');
    expect(result.errors).toContain('Adapter identity must be readonly class fields, not constructor super() options.');
    expect(result.errors).toContain('this.dom is not part of the AdapterBase contract. Use this.adapter.asCheerio(document).');
    expect(result.errors).toContain('Extraction function extractChapterImageUrls must accept (document: unknown, sourceUrl: string).');
  });

  it('rejects extraction methods implemented directly on the adapter shell', () => {
    const result = validateAdapterImplementationDraft(`
import { AdapterBase, CommonCapability, ChapterImagesCapability } from '../adapter/base';

export class BadAdapter extends AdapterBase {
  readonly id = 'bad';
  readonly name = 'Bad';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: false, metadata: false, chapterImages: true };
  readonly common = new BadCommonCapability(this);
  readonly chapterImages = new BadChapterImagesCapability(this);
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    return [];
  }
}

class BadCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return url.includes('example.com'); }
}
class BadChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] { return []; }
}
`, { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Extraction method extractChapterImageUrls must be implemented in a capability subclass, not directly on the AdapterBase shell class.');
  });

  it('rejects direct capability base-class instantiation', () => {
    const result = validateAdapterImplementationDraft(`
import { AdapterBase, CommonCapability, ChapterImagesCapability } from '../adapter/base';

export class BadAdapter extends AdapterBase {
  readonly id = 'bad';
  readonly name = 'Bad';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: false, metadata: false, chapterImages: true };
  readonly common = new CommonCapability(this);
  readonly chapterImages = new ChapterImagesCapability(this);
}
`, { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Capability base classes must not be instantiated directly; create site-specific subclasses.');
    expect(result.errors).toContain('Missing site-specific CommonCapability subclass.');
    expect(result.errors).toContain('Missing site-specific ChapterImagesCapability subclass.');
  });
});
