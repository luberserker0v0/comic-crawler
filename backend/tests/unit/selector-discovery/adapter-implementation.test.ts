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
    expect(result.errors).toContain('Implementation must not mention old façade functions fetchMetadata or fetchChapterImages.');
  });
});
