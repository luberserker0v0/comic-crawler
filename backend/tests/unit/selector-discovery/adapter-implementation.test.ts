import { describe, expect, it } from '@jest/globals';
import { validateAdapterImplementationDraft, validateCapabilityDraft } from '../../../src/selector-discovery/adapter-implementation';

const VALID_CHAPTER_ONLY_ADAPTER = `
import { AdapterBase, ChapterImagesCapability, CommonCapability, VerificationCapability } from '../adapter/base';

export class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new DemoCommonCapability(this);
  readonly verification = new DemoVerificationCapability(this);
  readonly chapterImages = new DemoChapterImagesCapability(this);
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }
}

class DemoVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|blocked|challenge|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Task Detail handoff',
    };
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
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new BadCommonCapability(this);
  readonly verification = new BadVerificationCapability(this);
  readonly chapterImages = new BadChapterImagesCapability(this);
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    return [];
  }
}

class BadCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return url.includes('example.com'); }
}
class BadVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean { return /blocked/.test(input); }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: true }; }
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
import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../adapter/base';

export class BadAdapter extends AdapterBase {
  readonly id = 'bad';
  readonly name = 'Bad';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new CommonCapability(this);
  readonly verification = new VerificationCapability(this);
  readonly chapterImages = new ChapterImagesCapability(this);
}
`, { target: 'chapter-only' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Capability base classes must not be instantiated directly; create site-specific subclasses.');
    expect(result.errors).toContain('Missing site-specific CommonCapability subclass.');
    expect(result.errors).toContain('Missing site-specific VerificationCapability subclass.');
    expect(result.errors).toContain('Missing site-specific ChapterImagesCapability subclass.');
  });

  it('does not confuse prose mentions with method signatures', () => {
    const result = validateCapabilityDraft(`
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  // extractTitle (from page heading)
  extractTitle(document: unknown, sourceUrl: string): string { return 'Demo'; }
  // extractAuthor (from author label)
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { return []; }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { return undefined; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] { return []; }
}
`, { stage: 'metadata', target: 'full' });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects combined capability handlers that use implements', () => {
    const result = validateCapabilityDraft(`
import { CommonCapability, VerificationCapability } from '../adapter/base';

class BadCommonVerificationCapability extends CommonCapability implements VerificationCapability {
  matchUrl(url: string): boolean { return url.includes('example.com'); }
  detectVerificationRequired(input: string): boolean { return /blocked/.test(input); }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: true }; }
}
`, { stage: 'common-verification' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Capability handlers must not be combined with implements; create one site-specific subclass per capability base class.');
  });

  it('accepts a common and verification capability stage draft', () => {
    const result = validateCapabilityDraft(`
import { AdapterBase, CommonCapability, VerificationCapability } from '../adapter/base';

export class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'interactive' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: false };
  readonly common = new DemoCommonCapability(this);
  readonly verification = new DemoVerificationCapability(this);
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }
}

class DemoVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|blocked|challenge|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return { supported: true, flow: 'Task Detail handoff' };
  }
}
`, { stage: 'common-verification', target: 'chapter-only' });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects common and verification drafts without verification capability', () => {
    const result = validateCapabilityDraft(`
import { AdapterBase, CommonCapability } from '../adapter/base';

export class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: false, metadata: false, chapterImages: false };
  readonly common = new DemoCommonCapability(this);
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return url.includes('example.com'); }
}
`, { stage: 'common-verification' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Common/verification draft must declare readonly verification handler.');
    expect(result.errors).toContain('Missing site-specific VerificationCapability subclass.');
    expect(result.errors).toContain('Every adapter draft must declare verification: true because VerificationCapability gates DOM trust.');
  });

  it('keeps metadata and chapter image capability stages mutually scoped', () => {
    const metadata = validateCapabilityDraft(`
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability, ChapterImagesCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string { return 'Demo'; }
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { return []; }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { return undefined; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] { return []; }
}
class BadChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] { return []; }
}
`, { stage: 'metadata', target: 'full' });

    expect(metadata.valid).toBe(false);
    expect(metadata.errors).toContain('Metadata draft must not implement ChapterImagesCapability.');

    const images = validateCapabilityDraft(`
import { ChapterImagesCapability } from '../adapter/base';

class DemoChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] { return []; }
}
`, { stage: 'chapter-images', target: 'chapter-only' });

    expect(images.valid).toBe(true);
    expect(images.errors).toEqual([]);
  });
});
