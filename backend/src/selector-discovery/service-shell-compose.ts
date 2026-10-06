import { extractRepresentativeChapterUrl } from './task-markdown';
import type { DynamicSiteAdapterManifest } from '../adapter/dynamic-site-adapter';
import type {
  SelectorDiscoveryCapabilityDraft,
  SelectorDiscoveryJob,
} from './types';

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
  const commonSource = drafts.find((draft) => draft.stage === 'common-verification')?.sourceTs ?? '';
  const commonClass = extractCapabilityClassName(commonSource, 'CommonCapability');
  const verificationClass = extractCapabilityClassName(commonSource, 'VerificationCapability');
  const metadataClass = extractCapabilityClassName(drafts.find((draft) => draft.stage === 'metadata')?.sourceTs ?? '', 'MetadataCapability');
  const chapterImagesClass = extractCapabilityClassName(drafts.find((draft) => draft.stage === 'chapter-images')?.sourceTs ?? '', 'ChapterImagesCapability');
  const classPrefix = toPascalIdentifier(job.hostname.replace(/^m\./i, ''));
  const adapterId = createAdapterId(job.hostname);
  const capabilities = {
    verification: true,
    metadata: job.target !== 'chapter-only',
    chapterImages: true,
  };
  const shell = `export class ${classPrefix}Adapter extends AdapterBase {
  readonly id = '${adapterId}';
  readonly name = '${toDisplayName(job.hostname)}';
  readonly domains = ['${job.hostname}'];
  readonly parseMode = 'static' as const;
  readonly capabilities = {
    verification: ${capabilities.verification},
    metadata: ${capabilities.metadata},
    chapterImages: ${capabilities.chapterImages},
  };

  readonly common = new ${commonClass}(this);
  readonly verification = new ${verificationClass}(this);
${capabilities.metadata ? `  readonly metadata = new ${metadataClass}(this);\n` : ''}  readonly chapterImages = new ${chapterImagesClass}(this);
}`;
  const body = sources.map(stripTypeScriptImports).join('\n\n');
  return {
    adapterImplementationTs: `import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
  MetadataCapability,
  ChapterImagesCapability,
} from '../../base';

${shell}

${body}
`,
    reviewNotesMarkdown: `# System-Composed Adapter Draft

ComicCrawler assembled the AdapterBase shell from reviewed capability drafts.
AO/Agent produced only capability subclasses.

## Adapter Identity

- id: ${adapterId}
- name: ${toDisplayName(job.hostname)}
- domains: ${job.hostname}
- parseMode: static

## Capability Classes

- CommonCapability: ${commonClass}
- VerificationCapability: ${verificationClass}
- MetadataCapability: ${capabilities.metadata ? metadataClass : 'not implemented for chapter-only target'}
- ChapterImagesCapability: ${chapterImagesClass}
`,
  };
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
    for (const className of extractCssClassNames(selector)) {
      const evidenceNeedles = [
        `.${className.toLowerCase()}`,
        `class=${className.toLowerCase()}`,
        `class="${className.toLowerCase()}`,
      ];
      if (!evidenceNeedles.some((needle) => normalizedTask.includes(needle))) {
        const key = `class:${className}`;
        if (!reported.has(key)) {
          errors.push(`Metadata selector ".${className}" is not present in task DOM evidence.`);
          reported.add(key);
        }
      }
    }
    for (const pathNeedle of extractHrefPathNeedles(selector)) {
      if (!normalizedTask.includes(pathNeedle.toLowerCase())) {
        const key = `href:${pathNeedle}`;
        if (!reported.has(key)) {
          errors.push(`Metadata selector href path "${pathNeedle}" is not present in task URL evidence.`);
          reported.add(key);
        }
      }
    }
  }
  return errors;
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
  return `import {
  CommonCapability,
  VerificationCapability,
} from '../../base';

class ${classPrefix}CommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (parsed.hostname === '${hostname}' || parsed.hostname === '${baseHostname}') &&
        (${pathCheck});
    } catch {
      return false;
    }
  }
}

class ${classPrefix}VerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|captcha|blocked|challenge|cf[-_]?chl|cf_clearance|just a moment|checking your browser|attention required|人机验证|人機驗證|HTTP\\s+(?:403|429|503)\\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Task enters waiting_verification and the user completes verification through the task detail handoff.',
    };
  }
}
`;
}

export function createMetadataSkeleton(hostname: string): string {
  const classPrefix = toPascalIdentifier(hostname.replace(/^m\./i, ''));
  return `import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import { MetadataCapability } from '../../base';

class ${classPrefix}MetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific title extraction from task.md evidence.');
  }

  extractAuthor(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific author extraction from task.md evidence.');
  }

  extractDescription(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific description extraction from task.md evidence.');
  }

  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific cover URL extraction from task.md evidence.');
  }

  extractTags(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific tag extraction from task.md evidence.');
  }

  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific status extraction from task.md evidence.');
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    void $;
    throw new Error('Replace with site-specific chapter list extraction from task.md evidence.');
  }
}
`;
}

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
