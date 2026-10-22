import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateAdapterImplementationDraft, validateCapabilityDraft } from '../../../src/selector-discovery/adapter-implementation';

const VALID_CHAPTER_ONLY_ADAPTER = `
import { AdapterBase, ChapterImagesCapability, CommonCapability, VerificationCapability } from '../adapter/base';

export class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains = ['demo.test'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new DemoCommonCapability(this);
  readonly verification = new DemoVerificationCapability(this);
  readonly chapterImages = new DemoChapterImagesCapability(this);
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'demo.test';
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
  validateAdapterImplementationDraftTestGroup1();
  validateAdapterImplementationDraftTestGroup2();
  validateAdapterImplementationDraftTestGroup3();
});

function validateAdapterImplementationDraftTestGroup1(): void {
  it('accepts an AdapterBase TypeScript implementation draft', validateAdapterImplementationDraftTestAcceptsAnAdapterBaseTypeScriptImplementationDraft);
  it('rejects non-playwright parseMode in generated drafts', validateAdapterImplementationDraftTestRejectsNonPlaywrightParseModeInGeneratedDrafts);
  it('rejects drafts that do not extend AdapterBase', validateAdapterImplementationDraftTestRejectsDraftsThatDoNotExtendAdapterBase);
  it('rejects forbidden runtime APIs', validateAdapterImplementationDraftTestRejectsForbiddenRuntimeAPIs);
  it('rejects filesystem subpath imports', validateAdapterImplementationDraftTestRejectsFilesystemSubpathImports);
  it('rejects non-AdapterBase DOM APIs and constructor identity objects', validateAdapterImplementationDraftTestRejectsNonAdapterBaseDOMAPIsAndConstructorIdentityObjects);
  it('rejects extraction methods implemented directly on the adapter shell', validateAdapterImplementationDraftTestRejectsExtractionMethodsImplementedDirectlyOnTheAdapterShell);
  it('rejects direct capability base-class instantiation', validateAdapterImplementationDraftTestRejectsDirectCapabilityBaseClassInstantiation);
  it('does not confuse prose mentions with method signatures', validateAdapterImplementationDraftTestDoesNotConfuseProseMentionsWithMethodSignatures);
  it('rejects metadata drafts that keep the template selectors unchanged', validateAdapterImplementationDraftTestRejectsMetadataDraftsThatKeepTheTemplateSelectorsUnchanged);
}

function validateAdapterImplementationDraftTestGroup2(): void {
  it('rejects metadata drafts that confuse ComicStatus with ChapterInfo task status or omit chapter ids', validateAdapterImplementationDraftTestRejectsMetadataDraftsThatConfuseComicStatusWithChapterInfoTaskStatusOrOmitChapterIds);
  it('rejects metadata drafts that return malformed ChapterInfo objects', validateAdapterImplementationDraftTestRejectsMetadataDraftsThatReturnMalformedChapterInfoObjects);
  it('rejects chapter lists that use relative urls or index-derived ids', validateAdapterImplementationDraftTestRejectsChapterListsThatUseRelativeUrlsOrIndexDerivedIds);
  it('accepts ChapterInfo object shorthand for id and url fields', validateAdapterImplementationDraftTestAcceptsChapterInfoObjectShorthandForIdAndUrlFields);
  it('rejects combined capability handlers that use implements', validateAdapterImplementationDraftTestRejectsCombinedCapabilityHandlersThatUseImplements);
  it('rejects self-declared framework classes and invented verification APIs', validateAdapterImplementationDraftTestRejectsSelfDeclaredFrameworkClassesAndInventedVerificationAPIs);
  it('rejects common-verification drafts that keep template placeholders', validateAdapterImplementationDraftTestRejectsCommonVerificationDraftsThatKeepTemplatePlaceholders);
  it('accepts a common and verification capability stage draft', validateAdapterImplementationDraftTestAcceptsACommonAndVerificationCapabilityStageDraft);
  it('rejects bare Cloudflare keyword challenge detection', validateAdapterImplementationDraftTestRejectsBareCloudflareKeywordChallengeDetection);
  it('accepts Cloudflare challenge-specific verification signals', validateAdapterImplementationDraftTestAcceptsCloudflareChallengeSpecificVerificationSignals);
}

function validateAdapterImplementationDraftTestGroup3(): void {
  it('keeps the common-verification AO template free of bare Cloudflare matches', validateAdapterImplementationDraftTestKeepsTheCommonVerificationAOTemplateFreeOfBareCloudflareMatches);
  it('rejects common and verification drafts without verification capability', validateAdapterImplementationDraftTestRejectsCommonAndVerificationDraftsWithoutVerificationCapability);
  it('keeps metadata and chapter image capability stages mutually scoped', validateAdapterImplementationDraftTestKeepsMetadataAndChapterImageCapabilityStagesMutuallyScoped);
}

function validateAdapterImplementationDraftTestAcceptsAnAdapterBaseTypeScriptImplementationDraft() {
    const result = validateAdapterImplementationDraft(VALID_CHAPTER_ONLY_ADAPTER, { target: 'chapter-only' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.syntaxValid).toBe(true);
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_NON_PLAYWRIGHT_PARSE_MODE_IN_GENERATED_DRAFTS_1_SOURCE = `readonly parseMode = 'playwright' as const;`;

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_NON_PLAYWRIGHT_PARSE_MODE_IN_GENERATED_DRAFTS_2_SOURCE = `readonly parseMode = 'static' as const;`;

function validateAdapterImplementationDraftTestRejectsNonPlaywrightParseModeInGeneratedDrafts() {
    const result = validateAdapterImplementationDraft(VALID_CHAPTER_ONLY_ADAPTER.replace(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_NON_PLAYWRIGHT_PARSE_MODE_IN_GENERATED_DRAFTS_1_SOURCE, VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_NON_PLAYWRIGHT_PARSE_MODE_IN_GENERATED_DRAFTS_2_SOURCE), { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('parseMode must be "playwright".');
}

function validateAdapterImplementationDraftTestRejectsDraftsThatDoNotExtendAdapterBase() {
    const result = validateAdapterImplementationDraft('export class Demo {}', { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Implementation must export a class that extends AdapterBase.');
}

function validateAdapterImplementationDraftTestRejectsForbiddenRuntimeAPIs() {
    const result = validateAdapterImplementationDraft(`${VALID_CHAPTER_ONLY_ADAPTER}\nprocess.exit(1);`, { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Direct process access is not allowed.');
}

function validateAdapterImplementationDraftTestRejectsFilesystemSubpathImports() {
    const result = validateAdapterImplementationDraft(`import { readFile } from 'node:fs/promises';\n${VALID_CHAPTER_ONLY_ADAPTER}`, { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Filesystem imports are not allowed.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_NON_ADAPTER_BASE_DOMAPIS_AND_CONSTRUCTOR_IDENTITY_OBJECTS_1_SOURCE = `
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
`;

function validateAdapterImplementationDraftTestRejectsNonAdapterBaseDOMAPIsAndConstructorIdentityObjects() {
    const result = validateAdapterImplementationDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_NON_ADAPTER_BASE_DOMAPIS_AND_CONSTRUCTOR_IDENTITY_OBJECTS_1_SOURCE, { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Generic Capability imports/usages are not part of the AdapterBase contract.');
    expect(result.errors).toContain('Importing from "comiccrawler" is not valid in adapter implementation drafts.');
    expect(result.errors).toContain('Adapter identity must be readonly class fields, not constructor super() options.');
    expect(result.errors).toContain('this.dom is not part of the AdapterBase contract. Use this.adapter.asCheerio(document).');
    expect(result.errors).toContain('Extraction function extractChapterImageUrls must accept (document: unknown, sourceUrl: string).');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_EXTRACTION_METHODS_IMPLEMENTED_DIRECTLY_ON_THE_ADAPTER_SHELL_1_SOURCE = `
import { AdapterBase, CommonCapability, ChapterImagesCapability } from '../adapter/base';

export class BadAdapter extends AdapterBase {
  readonly id = 'bad';
  readonly name = 'Bad';
  readonly domains = ['demo.test'];
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
  matchUrl(url: string): boolean { return url.includes('demo.test'); }
}
class BadVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean { return /blocked/.test(input); }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: true }; }
}
class BadChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] { return []; }
}
`;

function validateAdapterImplementationDraftTestRejectsExtractionMethodsImplementedDirectlyOnTheAdapterShell() {
    const result = validateAdapterImplementationDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_EXTRACTION_METHODS_IMPLEMENTED_DIRECTLY_ON_THE_ADAPTER_SHELL_1_SOURCE, { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Extraction method extractChapterImageUrls must be implemented in a capability subclass, not directly on the AdapterBase shell class.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_DIRECT_CAPABILITY_BASE_CLASS_INSTANTIATION_1_SOURCE = `
import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../adapter/base';

export class BadAdapter extends AdapterBase {
  readonly id = 'bad';
  readonly name = 'Bad';
  readonly domains = ['demo.test'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new CommonCapability(this);
  readonly verification = new VerificationCapability(this);
  readonly chapterImages = new ChapterImagesCapability(this);
}
`;

function validateAdapterImplementationDraftTestRejectsDirectCapabilityBaseClassInstantiation() {
    const result = validateAdapterImplementationDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_DIRECT_CAPABILITY_BASE_CLASS_INSTANTIATION_1_SOURCE, { target: 'chapter-only' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Capability base classes must not be instantiated directly; create site-specific subclasses.');
    expect(result.errors).toContain('Missing site-specific CommonCapability subclass.');
    expect(result.errors).toContain('Missing site-specific VerificationCapability subclass.');
    expect(result.errors).toContain('Missing site-specific ChapterImagesCapability subclass.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_DOES_NOT_CONFUSE_PROSE_MENTIONS_WITH_METHOD_SIGNATURES_1_SOURCE = `
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
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] { return [{ id: 'chapter-1', title: 'Chapter 1', url: sourceUrl }]; }
}
`;

function validateAdapterImplementationDraftTestDoesNotConfuseProseMentionsWithMethodSignatures() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_DOES_NOT_CONFUSE_PROSE_MENTIONS_WITH_METHOD_SIGNATURES_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_METADATA_DRAFTS_THAT_KEEP_THE_TEMPLATE_SELECTORS_UNCHANGED_1_SOURCE = `
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string { const $ = this.adapter.asCheerio(document); return $('main h1').text(); }
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { const $ = this.adapter.asCheerio(document); return $('.author a').text() || undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { const $ = this.adapter.asCheerio(document); return $('.description').text() || undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { const $ = this.adapter.asCheerio(document); const raw = $('.cover img').attr('src'); return raw ? this.adapter.resolveUrl(sourceUrl, raw) : undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { const $ = this.adapter.asCheerio(document); return $('.tags a').map((_, el) => $(el).text()).get(); }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { const $ = this.adapter.asCheerio(document); return $('.status').text() ? 'ongoing' : undefined; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] { const $ = this.adapter.asCheerio(document); return $('.chapter-list a[href*="/read/"]').map((_, el) => ({ id: $(el).text(), title: $(el).text(), url: this.adapter.resolveUrl(sourceUrl, $(el).attr('href') ?? ''), number: 1 })).get(); }
}
`;

function validateAdapterImplementationDraftTestRejectsMetadataDraftsThatKeepTheTemplateSelectorsUnchanged() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_METADATA_DRAFTS_THAT_KEEP_THE_TEMPLATE_SELECTORS_UNCHANGED_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Metadata draft still uses template selectors instead of site-specific selectors from task evidence.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_METADATA_DRAFTS_THAT_CONFUSE_COMIC_STATUS_WITH_CHAPTER_INFO_TASK_STATUS_OR_OMIT_CHAPTER_IDS_1_SOURCE = `
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string { return 'Demo'; }
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { return []; }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { return ComicStatus.Ongoing; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    return [{ title: 'Chapter 1', url: sourceUrl, status: 'ongoing' } as ChapterInfo];
  }
}
`;

function validateAdapterImplementationDraftTestRejectsMetadataDraftsThatConfuseComicStatusWithChapterInfoTaskStatusOrOmitChapterIds() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_METADATA_DRAFTS_THAT_CONFUSE_COMIC_STATUS_WITH_CHAPTER_INFO_TASK_STATUS_OR_OMIT_CHAPTER_IDS_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ComicStatus is a string union; return "ongoing", "completed", or "unknown" instead of ComicStatus enum members.');
    expect(result.errors).toContain('ChapterInfo entries must not use ComicStatus for status; status is task state metadata, not comic publication status.');
    expect(result.errors).toContain('extractChapterList must populate ChapterInfo.id for each chapter.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_METADATA_DRAFTS_THAT_RETURN_MALFORMED_CHAPTER_INFO_OBJECTS_1_SOURCE = `
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string { return 'Demo'; }
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { return []; }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { return 'ongoing'; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    return [{ id: 'chapter-1', title: 'Chapter 1', sourceUrl, date: new Date() } as unknown as ChapterInfo];
  }
}
`;

function validateAdapterImplementationDraftTestRejectsMetadataDraftsThatReturnMalformedChapterInfoObjects() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_METADATA_DRAFTS_THAT_RETURN_MALFORMED_CHAPTER_INFO_OBJECTS_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('extractChapterList must populate ChapterInfo.url with an absolute chapter URL.');
    expect(result.errors).toContain('ChapterInfo uses url, not sourceUrl.');
    expect(result.errors).toContain('extractChapterList must not use new Date() as a placeholder for chapter dates.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_CHAPTER_LISTS_THAT_USE_RELATIVE_URLS_OR_INDEX_DERIVED_IDS_1_SOURCE = `
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string { return 'Demo'; }
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { return []; }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { return 'ongoing'; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const href = '/chapter-1';
    return [{ id: String(index + 1), title: 'Chapter 1', url: href } as ChapterInfo];
  }
}
`;

function validateAdapterImplementationDraftTestRejectsChapterListsThatUseRelativeUrlsOrIndexDerivedIds() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_CHAPTER_LISTS_THAT_USE_RELATIVE_URLS_OR_INDEX_DERIVED_IDS_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ChapterInfo.url must be absolute; resolve relative hrefs with this.adapter.resolveUrl(sourceUrl, rawHref).');
    expect(result.errors).toContain('ChapterInfo.id must be derived from the chapter URL path segment, not list index.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_ACCEPTS_CHAPTER_INFO_OBJECT_SHORTHAND_FOR_ID_AND_URL_FIELDS_1_SOURCE = `
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../adapter/base';

class DemoMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string { return 'Demo'; }
  extractAuthor(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractDescription(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined { return undefined; }
  extractTags(document: unknown, sourceUrl: string): string[] { return []; }
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined { return 'ongoing'; }
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const rawHref = '/manga/demo/chapter-1';
    const url = this.adapter.resolveUrl(sourceUrl, rawHref);
    const id = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'chapter-1';
    const title = 'Chapter 1';
    return [{ id, title, url }];
  }
}
`;

function validateAdapterImplementationDraftTestAcceptsChapterInfoObjectShorthandForIdAndUrlFields() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_ACCEPTS_CHAPTER_INFO_OBJECT_SHORTHAND_FOR_ID_AND_URL_FIELDS_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_COMBINED_CAPABILITY_HANDLERS_THAT_USE_IMPLEMENTS_1_SOURCE = `
import { CommonCapability, VerificationCapability } from '../adapter/base';

class BadCommonVerificationCapability extends CommonCapability implements VerificationCapability {
  matchUrl(url: string): boolean { return url.includes('demo.test'); }
  detectVerificationRequired(input: string): boolean { return /blocked/.test(input); }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: true }; }
}
`;

function validateAdapterImplementationDraftTestRejectsCombinedCapabilityHandlersThatUseImplements() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_COMBINED_CAPABILITY_HANDLERS_THAT_USE_IMPLEMENTS_1_SOURCE, { stage: 'common-verification' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Capability handlers must not be combined with implements; create one site-specific subclass per capability base class.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_SELF_DECLARED_FRAMEWORK_CLASSES_AND_INVENTED_VERIFICATION_APIS_1_SOURCE = `
declare class AdapterBase {}
declare class CommonCapability {}
declare class VerificationCapability {}

class DemoAdapter extends AdapterBase {
  readonly id = 'demo';
  readonly name = 'Demo';
  readonly domains: Set<string> = new Set(['https://demo.test']);
  readonly parseMode: 'metadata' | 'chapterImage' | 'both' = 'both';
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };
  readonly common = new DemoCommonCapability();
  readonly verification = new DemoVerificationCapability();

  extractTitle(document: unknown, sourceUrl: string): string | null {
    return 'placeholder';
  }
}

class DemoCommonCapability extends CommonCapability {
  matchUrl(sourceUrl: string): boolean { return sourceUrl.includes('demo.test'); }
}

class DemoVerificationCapability extends VerificationCapability {
  verifyDom(document: unknown, sourceUrl: string): Promise<boolean> { return Promise.resolve(false); }
}
`;

function validateAdapterImplementationDraftTestRejectsSelfDeclaredFrameworkClassesAndInventedVerificationAPIs() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_SELF_DECLARED_FRAMEWORK_CLASSES_AND_INVENTED_VERIFICATION_APIS_1_SOURCE, { stage: 'common-verification' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Do not redeclare ComicCrawler framework classes. Import AdapterBase and capability classes from the adapter base.');
    expect(result.errors).toContain('VerificationCapability must implement detectVerificationRequired(input: string), not verifyDom().');
    expect(result.errors).toContain('Common/verification draft must not implement metadata or chapter image extraction methods.');
    expect(result.errors).toContain('Common/verification draft must not export or implement an AdapterBase shell.');
    expect(result.errors).toContain('Common/verification draft must not declare adapter identity, constructor, capability flags, or handler fields.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_COMMON_VERIFICATION_DRAFTS_THAT_KEEP_TEMPLATE_PLACEHOLDERS_1_SOURCE = `
import { AdapterBase, CommonCapability, VerificationCapability } from '../adapter/base';

export class SiteAdapter extends AdapterBase {
  readonly id = 'my-site-adapter';
  readonly name = 'Generic Comic Site';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: false };
  readonly common = new SiteCommonCapability(this);
  readonly verification = new SiteVerificationCapability(this);
}
class SiteCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return /^https?:\\/\\/example\\.com\\//i.test(url); }
}
class SiteVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean { return /blocked/.test(input); }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: true }; }
}
`;

function validateAdapterImplementationDraftTestRejectsCommonVerificationDraftsThatKeepTemplatePlaceholders() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_COMMON_VERIFICATION_DRAFTS_THAT_KEEP_TEMPLATE_PLACEHOLDERS_1_SOURCE, { stage: 'common-verification' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Template placeholder values must be replaced with site-specific identity and domains.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_ACCEPTS_ACOMMON_AND_VERIFICATION_CAPABILITY_STAGE_DRAFT_1_SOURCE = `
import { CommonCapability, VerificationCapability } from '../adapter/base';

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'demo.test';
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
`;

function validateAdapterImplementationDraftTestAcceptsACommonAndVerificationCapabilityStageDraft() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_ACCEPTS_ACOMMON_AND_VERIFICATION_CAPABILITY_STAGE_DRAFT_1_SOURCE, { stage: 'common-verification', target: 'chapter-only' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_BARE_CLOUDFLARE_KEYWORD_CHALLENGE_DETECTION_1_SOURCE = `
import { CommonCapability, VerificationCapability } from '../adapter/base';

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'demo.test';
  }
}

class DemoVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|captcha|blocked|challenge|cloudflare|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return { supported: true };
  }
}
`;

function validateAdapterImplementationDraftTestRejectsBareCloudflareKeywordChallengeDetection() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_BARE_CLOUDFLARE_KEYWORD_CHALLENGE_DETECTION_1_SOURCE, { stage: 'common-verification' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('detectVerificationRequired must not match the bare word "cloudflare"; normal pages can contain Cloudflare scripts. Match challenge-specific signals instead.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_ACCEPTS_CLOUDFLARE_CHALLENGE_SPECIFIC_VERIFICATION_SIGNALS_1_SOURCE = `
import { CommonCapability, VerificationCapability } from '../adapter/base';

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'demo.test';
  }
}

class DemoVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /cloudflare.{0,80}(?:challenge|verification)|cf[-_]?chl|cf_clearance|just a moment|checking your browser|attention required/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return { supported: true };
  }
}
`;

function validateAdapterImplementationDraftTestAcceptsCloudflareChallengeSpecificVerificationSignals() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_ACCEPTS_CLOUDFLARE_CHALLENGE_SPECIFIC_VERIFICATION_SIGNALS_1_SOURCE, { stage: 'common-verification' });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
}

function validateAdapterImplementationDraftTestKeepsTheCommonVerificationAOTemplateFreeOfBareCloudflareMatches() {
    const template = readFileSync(join(process.cwd(), '..', 'agent/ao/selector-discovery/draft/contracts/common-verification-template.ts'), 'utf-8');
    expect(template).not.toMatch(/\|cloudflare\|/i);
    expect(template).toMatch(/cf\[-_\]\?chl/);
    expect(template).toMatch(/cf_clearance/);
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_COMMON_AND_VERIFICATION_DRAFTS_WITHOUT_VERIFICATION_CAPABILITY_1_SOURCE = `
import { CommonCapability } from '../adapter/base';

class DemoCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return url.includes('demo.test'); }
}
`;

function validateAdapterImplementationDraftTestRejectsCommonAndVerificationDraftsWithoutVerificationCapability() {
    const result = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_REJECTS_COMMON_AND_VERIFICATION_DRAFTS_WITHOUT_VERIFICATION_CAPABILITY_1_SOURCE, { stage: 'common-verification' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing site-specific VerificationCapability subclass.');
}

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_KEEPS_METADATA_AND_CHAPTER_IMAGE_CAPABILITY_STAGES_MUTUALLY_SCOPED_1_SOURCE = `
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { AdapterBase, MetadataCapability, ChapterImagesCapability, CommonCapability, VerificationCapability } from '../adapter/base';

export class BadAdapter extends AdapterBase {}

class BadCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return url.includes('demo.test'); }
}

class BadVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean { return /blocked/.test(input); }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: true }; }
}

class DemoMetadataCapability extends MetadataCapability {
  readonly id = 'bad';
  constructor() { super({}); }
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
`;

const VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_KEEPS_METADATA_AND_CHAPTER_IMAGE_CAPABILITY_STAGES_MUTUALLY_SCOPED_2_SOURCE = `
import { ChapterImagesCapability } from '../adapter/base';

class DemoChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] { return []; }
}
`;

function validateAdapterImplementationDraftTestKeepsMetadataAndChapterImageCapabilityStagesMutuallyScoped() {
    const metadata = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_KEEPS_METADATA_AND_CHAPTER_IMAGE_CAPABILITY_STAGES_MUTUALLY_SCOPED_1_SOURCE, { stage: 'metadata', target: 'full' });
    expect(metadata.valid).toBe(false);
    expect(metadata.errors).toContain('Metadata draft must not implement ChapterImagesCapability.');
    expect(metadata.errors).toContain('Metadata draft must not export an AdapterBase shell.');
    expect(metadata.errors).toContain('Metadata draft must not implement common or verification capabilities.');
    expect(metadata.errors).toContain('Metadata draft must not declare adapter identity, constructor, common, or verification fields.');
    const images = validateCapabilityDraft(VALIDATE_ADAPTER_IMPLEMENTATION_DRAFT_KEEPS_METADATA_AND_CHAPTER_IMAGE_CAPABILITY_STAGES_MUTUALLY_SCOPED_2_SOURCE, { stage: 'chapter-images', target: 'chapter-only' });
    expect(images.valid).toBe(true);
    expect(images.errors).toEqual([]);
}
