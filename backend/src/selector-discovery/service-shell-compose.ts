import { extractRepresentativeChapterUrl } from './task-markdown';
import type { DynamicSiteAdapterManifest } from '../adapter/dynamic-site-adapter';
import type {
  SelectorDiscoveryCapabilityDraft,
  SelectorDiscoveryJob,
} from './types';

interface ShellParts {
  commonClass: string;
  verificationClass: string;
  metadataClass: string;
  readerPreparationClass: string;
  chapterImagesClass: string;
  classPrefix: string;
  adapterId: string;
  metadata: boolean;
}

export function hasCompleteImageSelectors(selectors: DynamicSiteAdapterManifest['selectors']['images'] | undefined): boolean {
  return Boolean(selectors?.item && selectors.srcAttr);
}

export function tryExtractRepresentativeChapterUrl(markdown: string, baseUrl: string): string | undefined {
  try {
    return extractRepresentativeChapterUrl(markdown, baseUrl);
  } catch {
    return undefined;
  }
}

export function safeAdapterId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dynamic-site';
}

export function composeAdapterShellFromCapabilities(
  job: SelectorDiscoveryJob,
  drafts: SelectorDiscoveryCapabilityDraft[]
): { reviewNotesMarkdown: string; adapterImplementationTs: string } {
  const sources = drafts.map((draft) => draft.sourceTs?.trim() ?? '').filter(Boolean);
  const parts = createShellParts(job, drafts);
  const shell = createAdapterShell(job, parts);
  return { adapterImplementationTs: composeImplementation(shell, sources),
    reviewNotesMarkdown: composeReviewNotes(job, parts) };
}

function createShellParts(job: SelectorDiscoveryJob,
  drafts: SelectorDiscoveryCapabilityDraft[]): ShellParts {
  const source = (stage: SelectorDiscoveryCapabilityDraft['stage']) =>
    drafts.find((draft) => draft.stage === stage)?.sourceTs ?? '';
  return { commonClass: extractCapabilityClassName(source('common-verification'), 'CommonCapability'),
    verificationClass: extractCapabilityClassName(source('common-verification'), 'VerificationCapability'),
    metadataClass: extractCapabilityClassName(source('metadata'), 'MetadataCapability'),
    readerPreparationClass: extractCapabilityClassName(
      source('reader-preparation'), 'ReaderPreparationCapability'),
    chapterImagesClass: extractCapabilityClassName(source('chapter-images'), 'ChapterImagesCapability'),
    classPrefix: toPascalIdentifier(job.hostname.replace(/^m\./i, '')),
    adapterId: createAdapterId(job.hostname), metadata: job.target !== 'chapter-only' };
}

function createAdapterShell(job: SelectorDiscoveryJob, parts: ShellParts): string {
  return `export class ${parts.classPrefix}Adapter extends AdapterBase {
  readonly id = '${parts.adapterId}';
  readonly name = '${toDisplayName(job.hostname)}';
  readonly domains = ['${job.hostname}'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = {
    verification: true,
    metadata: ${parts.metadata},
    chapterImages: true,
  };

  readonly common = new ${parts.commonClass}(this);
  readonly verification = new ${parts.verificationClass}(this);
${parts.metadata ? `  readonly metadata = new ${parts.metadataClass}(this);\n` : ''}  readonly chapterImages = new ${parts.chapterImagesClass}(this);
  readonly readerPreparation = new ${parts.readerPreparationClass}(this);
}`;
}

function composeImplementation(shell: string, sources: string[]): string {
  const body = sources.map(stripTypeScriptImports).join('\n\n');
  return `import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
  MetadataCapability,
  ReaderPreparationCapability,
  ChapterImagesCapability,
} from '../../base';

${shell}

${body}
`;
}

function composeReviewNotes(job: SelectorDiscoveryJob, parts: ShellParts): string {
  return `# System-Composed Adapter Draft

ComicCrawler assembled the AdapterBase shell from reviewed capability drafts.
AO/Agent produced only capability subclasses.

## Adapter Identity

- id: ${parts.adapterId}
- name: ${toDisplayName(job.hostname)}
- domains: ${job.hostname}
- parseMode: playwright

## Capability Classes

- CommonCapability: ${parts.commonClass}
- VerificationCapability: ${parts.verificationClass}
- MetadataCapability: ${parts.metadata ? parts.metadataClass : 'not implemented for chapter-only target'}
- ReaderPreparationCapability: ${parts.readerPreparationClass}
- ChapterImagesCapability: ${parts.chapterImagesClass}
`;
}

export function extractCapabilityClassName(source: string, baseClass: string): string {
  const match = new RegExp(`\\bclass\\s+(\\w+)\\s+extends\\s+${baseClass}\\b`).exec(source);
  if (!match?.[1]) {
    return `Missing${baseClass}`;
  }
  return match[1];
}

export function stripTypeScriptImports(source: string): string {
  return source
    .replace(/^import\s+type\s+[^;]+;\s*/gm, '')
    .replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^import\s+[^;]+;\s*/gm, '')
    .trim();
}

export function createAdapterId(hostname: string): string {
  return hostname.replace(/^www\./i, '').replace(/^m\./i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
}

export function validateMetadataSelectorEvidence(source: string, taskMarkdown: string): string[] {
  const errors: string[] = [];
  const selectors = extractCheerioSelectors(source);
  const normalizedTask = taskMarkdown.toLowerCase();
  const reported = new Set<string>();
  for (const selector of selectors) {
    if (selector.startsWith('meta[') || selector === 'title' || selector === 'body') continue;
    validateClassEvidence(selector, normalizedTask, reported, errors);
    validatePathEvidence(selector, normalizedTask, reported, errors);
  }
  return errors;
}

function validateClassEvidence(selector: string, task: string, reported: Set<string>, errors: string[]): void {
  for (const name of extractCssClassNames(selector)) {
    const lower = name.toLowerCase();
    const found = [`.${lower}`, `class=${lower}`, `class="${lower}`].some((needle) => task.includes(needle));
    const key = `class:${name}`;
    if (!found && !reported.has(key)) {
      errors.push(`Metadata selector ".${name}" is not present in task DOM evidence.`);
      reported.add(key);
    }
  }
}

function validatePathEvidence(selector: string, task: string, reported: Set<string>, errors: string[]): void {
  for (const path of extractHrefPathNeedles(selector)) {
    const key = `href:${path}`;
    if (!task.includes(path.toLowerCase()) && !reported.has(key)) {
      errors.push(`Metadata selector href path "${path}" is not present in task URL evidence.`);
      reported.add(key);
    }
  }
}

export function extractCheerioSelectors(source: string): string[] {
  const selectors: string[] = [];
  const pattern = /\$\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const selector = match[2]?.trim();
    if (!selector || selector.includes('<')) continue;
    selectors.push(selector);
  }
  return selectors;
}

export function extractCssClassNames(selector: string): string[] {
  const classes: string[] = [];
  const pattern = /\.([_a-zA-Z][-_a-zA-Z0-9]*)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selector)) !== null) {
    const className = match[1];
    if (className && className !== 'first' && className !== 'last') {
      classes.push(className);
    }
  }
  return classes;
}

export function extractHrefPathNeedles(selector: string): string[] {
  const needles: string[] = [];
  const pattern = /href[*^$|~]?=\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(selector)) !== null) {
    const value = match[1]?.trim();
    if (value?.startsWith('/')) needles.push(value);
  }
  return needles;
}

export function normalizeComparableText(value?: string): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function createCommonVerificationSkeleton(sourceUrl: string, hostname: string): string {
  const classPrefix = toPascalIdentifier(hostname.replace(/^m\./i, ''));
  const urlPath = safeUrlPathPrefix(sourceUrl);
  const baseHostname = hostname.replace(/^m\./i, '');
  const pathCheck = urlPath
    ? `parsed.pathname === '${urlPath}' || parsed.pathname.startsWith('${urlPath}/')`
    : `parsed.pathname.startsWith('/')`;
  return COMMON_VERIFICATION_SKELETON.replace(/\{\{CLASS\}\}/g, classPrefix)
    .replace(/\{\{HOST\}\}/g, hostname).replace(/\{\{BASE_HOST\}\}/g, baseHostname)
    .replace('{{PATH_CHECK}}', pathCheck);
}

const COMMON_VERIFICATION_SKELETON = `import {
  CommonCapability,
  VerificationCapability,
} from '../../base';

class {{CLASS}}CommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (parsed.hostname === '{{HOST}}' || parsed.hostname === '{{BASE_HOST}}') &&
        ({{PATH_CHECK}});
    } catch {
      return false;
    }
  }
}

class {{CLASS}}VerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|verify you are human|captcha|sorry, you have been blocked|you are unable to access|cdn-cgi\\/challenge-platform|cf[-_]?chl|cf_clearance|just a moment|checking your browser|attention required!|人机验证|人機驗證|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }
}
`;

export function createMetadataSkeleton(hostname: string): string {
  const classPrefix = toPascalIdentifier(hostname.replace(/^m\./i, ''));
  return METADATA_SKELETON.replace(/\{\{CLASS\}\}/g, classPrefix);
}

const METADATA_SKELETON = `import type { ChapterInfo } from '@comiccrawler/shared';
import { MetadataCapability } from '../../base';

class {{CLASS}}MetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific title extraction from task.md evidence.');
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific chapter list extraction from task.md evidence.');
  }
}
`;

export function toPascalIdentifier(value: string): string {
  const parts = value.split(/[^a-z0-9]+/i).filter(Boolean);
  const name = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : 'Site';
}

export function toDisplayName(hostname: string): string {
  return hostname.replace(/^m\./i, '').split('.').filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ');
}

export function safeUrlPathPrefix(sourceUrl: string): string {
  try {
    const path = new URL(sourceUrl).pathname;
    const firstSegment = path.split('/').filter(Boolean)[0];
    return firstSegment ? `/${firstSegment}` : '';
  } catch {
    return '';
  }
}

export function createChapterOnlyPhase1Markdown(finalUrl: string): string {
  return `# Phase 1 Result

## Site Decision

- Snapshot source: fetched chapter reader HTML.
- Discovery target: chapter-only adapter.

## Title Extraction

- Not required for chapter-only discovery.

## Chapter List Extraction

- Not required for chapter-only discovery.

## Representative Chapter URL

${finalUrl}

## Evidence

- The supplied URL is treated as the representative chapter page.
- Chapter-only discovery intentionally extracts image selectors only.

## Uncertainty

- Metadata and chapter list extraction are intentionally out of scope for chapter-only discovery.
`;
}
