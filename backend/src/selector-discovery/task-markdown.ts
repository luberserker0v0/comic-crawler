import * as cheerio from 'cheerio';
import { compactText, safeResolve, summarizeHtmlForAgent } from './html-summary';
import type { SafeHtmlFetchResult } from './safe-fetch';
import type { ParsedMarkdownCandidate } from './types';
import type { AdapterCapabilities, SiteSelectors } from '@comiccrawler/shared';

export interface ExistingAdapterCapabilityContext {
  adapterId: string;
  name: string;
  capabilities: AdapterCapabilities;
  imageSelectors?: SiteSelectors['images'];
  note?: string;
}

export function createCapabilityPipelineMarkdown(input: {
  target: 'full' | 'chapter-only';
  existingAdapter?: ExistingAdapterCapabilityContext;
}): string {
  const metadataStage = input.target === 'full'
    ? '3. MetadataCapability: extract title, author, description, cover URL, tags, status, and the full chapter list from trusted metadata DOM.'
    : '3. MetadataCapability: skipped for chapter-only discovery; do not invent metadata functions.';
  const chapterStageNumber = input.target === 'full' ? '4' : '3';
  return `## Capability Pipeline

Generate adapter behavior in capability stages. Do not treat discovery as one
large unstructured adapter-writing task. ComicCrawler assembles the final
AdapterBase shell from reviewed capability classes; agents do not write the
shell.

1. CommonCapability: match supported URLs and reject unrelated domains/paths.
2. VerificationCapability: always implement this capability. It detects blocked
   or challenge DOM and describes the official human handoff. Normal pages may
   return false, but the capability still exists because it gates DOM trust.
${metadataStage}
${chapterStageNumber}. ChapterImagesCapability: extract all comic page image URLs from trusted reader DOM.

Rules:

- Later extraction stages must assume the DOM has already passed
  VerificationCapability readiness.
- Capability handlers are mutually scoped: metadata code does not implement
  chapter image extraction, and chapter image code does not implement metadata.
- Keep site-specific clicking, filtering, expansion, and extraction logic inside
  the relevant capability source so humans can review it.
- Promotion mode: ${input.existingAdapter ? 'augment existing adapter capability' : 'create new adapter'}.
`;
}

export function createPhase1TaskMarkdown(input: {
  url: string;
  metadataFetch: SafeHtmlFetchResult;
  existingAdapter?: ExistingAdapterCapabilityContext;
}): string {
  return `# Selector Discovery Phase 1

## Goal

Analyze the comic metadata page and discover the site behavior needed to write TypeScript capability implementations.

Important rules:

- Write Markdown only.
- Do not output JSON.
- Do not generate adapter code in Phase 1.
- Write the final Phase 1 analysis directly. Do not output a plan, waiting note,
  or statement that a subagent/tool has not returned. If a tool fails, complete
  the analysis yourself from the DOM summary.
- Use divide-and-conquer. Do not try to reason over the whole HTML at once.
- If the chapter list appears partial, look for signals that the UI may collapse
  older chapters behind "more", "show all", "expand", "更多", "展开", "展開",
  "全部章節", "全部章节", "目录", "目錄", or similar controls.
- Selectors must describe the real catalog content, not navigation shortcuts such
  as "start reading" or "continue reading".
- Chapter-list extraction must return all catalog chapters visible in the trusted
  DOM, not a preview, first-chapters summary, or shortcut list.

## Source URL

${input.url}

${adapterImplementationContract(input.existingAdapter ? 'augment' : 'create')}

${createCapabilityPipelineMarkdown({ target: 'full', existingAdapter: input.existingAdapter })}

${formatExistingAdapterCapability(input.existingAdapter)}

## Safe Fetch Summary

- Final URL: ${input.metadataFetch.finalUrl}
- Content-Type: ${input.metadataFetch.contentType || 'unknown'}
- Redirects: ${input.metadataFetch.redirectChain.length === 0 ? 'none' : input.metadataFetch.redirectChain.join(' -> ')}

## DOM Summary

${summarizeHtmlForAgent(input.metadataFetch.html, input.metadataFetch.finalUrl, 'metadata')}

## HTML Analysis Plan

Analyze in this order:

1. Identify the primary content container.
2. Analyze each metadata field separately: title, author, cover URL, status, tags, and description.
3. Analyze chapter-list signals: list container, chapter item, chapter title, and chapter URL.
4. Choose one representative chapter URL that is likely to contain reader images.
5. Note whether the chapter list may be collapsed or incomplete.
6. Write the output using the Markdown outline in contracts/phase1-output.md.

## Mandatory Phase 1 Output Headings

Your output is invalid unless it uses these exact headings:

## Site Decision
## Title Extraction
## Author Extraction
## Description Extraction
## Cover URL Extraction
## Tags Extraction
## Status Extraction
## Chapter List Extraction
## Representative Chapter URL
## Evidence
## Uncertainty

Do not include "Adapter Identity", "Implementation Notes", TypeScript advice,
or code in Phase 1.
`;
}

export function createPhase2TaskMarkdown(input: {
  url: string;
  phase1Markdown: string;
  chapterFetch: SafeHtmlFetchResult;
  existingAdapter?: ExistingAdapterCapabilityContext;
}): string {
  return `# Selector Discovery Phase 2

## Goal

Use the Phase 1 result and the representative chapter page to produce human-reviewable TypeScript capability drafts plus Markdown review notes.

Important rules:

- Write Markdown only.
- Do not output JSON.
- Generate TypeScript only in the requested capability draft files.
- Do not write an AdapterBase shell; ComicCrawler assembles it after review.
- Do not implement fetchMetadata() or fetchChapterImages(); ComicCrawler composes those internally.
- Implement fine-grained extraction functions through AdapterBase/capability handlers.
- Use divide-and-conquer. Analyze image containers and lazy-loading attributes separately.
- Treat image extraction as the same reusable chapter-only unit used by direct
  chapter crawling.
- Image extraction must return all comic page image URLs visible in the trusted
  DOM, not firstImageUrls or a preview list.
- Confirm the representative chapter DOM belongs to the representative chapter
  URL, not a metadata/catalog page from the same domain.
- Do not use broad selectors such as body img or img[src] as the final image
  selector unless evidence shows the page contains only comic page images.
- Exclude covers, logos, browser/app promotion icons, UI assets, tracking pixels,
  and ads from image selector reasoning.
- Prefer reader containers and comic CDN/lazy-loading attributes over global
  image nodes.

## Source URL

${input.url}

${adapterImplementationContract(input.existingAdapter ? 'augment' : 'create')}

${createCapabilityPipelineMarkdown({ target: 'full', existingAdapter: input.existingAdapter })}

${formatExistingAdapterCapability(input.existingAdapter)}

## Phase 1 Result

${input.phase1Markdown}

## Representative Chapter Fetch Summary

- Final URL: ${input.chapterFetch.finalUrl}
- Content-Type: ${input.chapterFetch.contentType || 'unknown'}

## Representative Chapter DOM Summary

${summarizeHtmlForAgent(input.chapterFetch.html, input.chapterFetch.finalUrl, 'chapter')}

## HTML Analysis Plan

Analyze in this order:

1. Identify the reader/image container.
2. Compare image-bearing nodes: img, source, picture, and lazy-loading data attributes.
3. Separate comic page images from cover/logo/icon/UI/ad images.
4. Choose image item selector and source attribute.
5. Keep chapter image URL extraction in ChapterImagesCapability only.
6. Write review notes for the requested capability stage.
`;
}

function formatExistingAdapterCapability(existing?: ExistingAdapterCapabilityContext): string {
  if (!existing) return '';
  return `## Existing Adapter Capability

- Adapter ID: ${existing.adapterId}
- Name: ${existing.name}
- Current capabilities:
  - verification: ${existing.capabilities.verification ? 'true' : 'false'}
  - metadata: ${existing.capabilities.metadata ? 'true' : 'false'}
  - chapterImages: ${existing.capabilities.chapterImages ? 'true' : 'false'}
- Existing image selectors:
  - Container: ${existing.imageSelectors?.container ?? ''}
  - Item: ${existing.imageSelectors?.item ?? ''}
  - Source Attribute: ${existing.imageSelectors?.srcAttr ?? ''}
- Required work this run: add metadata and chapter-list selectors to this same adapter identity.
- Adapter identity rule: keep Adapter ID as ${existing.adapterId}; do not create a new adapter for the same domain.
- Note: ${existing.note ?? 'Reuse already reviewed image selectors unless the representative chapter explicitly proves a safer replacement.'}
`;
}

export function createChapterOnlyTaskMarkdown(input: {
  url: string;
  chapterFetch: SafeHtmlFetchResult;
}): string {
  return `# Selector Discovery Chapter-Only Candidate

## Goal

Analyze a comic reader chapter page and produce chapter-only TypeScript capability drafts.

This target implements only chapter image URL extraction:

- Metadata extraction functions are not required.
- Chapter list extraction is not required.
- Chapter Image URL Extraction is required.
- Write Markdown only.
- Do not output JSON.
- Generate TypeScript only in the requested capability draft files.
- Do not write an AdapterBase shell; ComicCrawler assembles it after review.
- Do not implement fetchMetadata() or fetchChapterImages(); ComicCrawler composes those internally.
- Use divide-and-conquer. Analyze image containers, repeated image nodes, and lazy-loading attributes separately.
- This is the reusable image extraction unit used by full discovery after
  metadata/chapter-list discovery chooses a representative chapter URL.
- Image extraction must return all comic page image URLs visible in the trusted
  DOM, not firstImageUrls or a preview list.
- Confirm the DOM belongs to the requested reader/chapter URL, not a catalog page
  from the same domain.
- Do not use broad selectors such as body img or img[src] as the final image
  selector unless evidence shows the page contains only comic page images.
- Exclude covers, logos, browser/app promotion icons, UI assets, tracking pixels,
  and ads from image selector reasoning.
- Prefer reader containers and comic CDN/lazy-loading attributes over global
  image nodes.

## Source URL

${input.url}

${adapterImplementationContract('create', 'chapter-only')}

${createCapabilityPipelineMarkdown({ target: 'chapter-only' })}

## Discovery Target

chapter-only adapter

## Chapter Fetch Summary

- Final URL: ${input.chapterFetch.finalUrl}
- Content-Type: ${input.chapterFetch.contentType || 'unknown'}
- Redirects: ${input.chapterFetch.redirectChain.length === 0 ? 'none' : input.chapterFetch.redirectChain.join(' -> ')}

## Chapter DOM Summary

${summarizeHtmlForAgent(input.chapterFetch.html, input.chapterFetch.finalUrl, 'chapter')}

## HTML Analysis Plan

Analyze in this order:

1. Identify the reader/image container.
2. Compare image-bearing nodes: img, source, picture, and lazy-loading data attributes.
3. Separate comic page images from cover/logo/icon/UI/ad images.
4. Choose image item selector and source attribute.
5. Mark metadata and chapter-list extraction as not required in review notes.
6. Write review notes for the requested capability stage.
`;
}

function adapterImplementationContract(mode: 'create' | 'augment', target: 'full' | 'chapter-only' = 'full'): string {
  const metadataRequirement = target === 'chapter-only'
    ? '- Do not declare metadata capability unless metadata functions are actually implemented.'
    : '- Implement metadata extraction: extractTitle, extractAuthor, extractDescription, extractCoverUrl, extractTags, extractStatus, and extractChapterList.';
  return `## Capability Implementation Contract

- Output only the TypeScript source file requested for the current capability stage.
- Do not output a site adapter class that extends AdapterBase.
- ComicCrawler assembles the AdapterBase shell from reviewed capability classes.
- Read and follow contracts/adapter-base-api.md for imports, capability class
  usage, method signatures, return shapes, helper methods, and parseMode meaning.
- Discovery is capability-staged. Always produce CommonCapability and
  VerificationCapability first; VerificationCapability gates whether the DOM is
  trusted for later metadata or chapter-image extraction.
- Import only the capability classes needed by the requested stage.
- Do not declare id, name, domains, parseMode, capabilities, handler fields, constructor, or super().
- Do not instantiate CommonCapability, VerificationCapability, MetadataCapability, or ChapterImagesCapability directly. Create site-specific subclasses that extend them.
- Implement CommonCapability.matchUrl for the site URL patterns.
- Always implement VerificationCapability to detect blocked/challenge pages and
  describe the official human handoff. If no challenge is observed,
  detectVerificationRequired still returns false for normal DOM and true for
  generic blocked/challenge signals. Do not bypass or automate CAPTCHA.
${metadataRequirement}
- Implement chapterImages.extractChapterImageUrls for chapter reader pages when chapterImages capability is true.
- Use exact method names: extractTitle, extractAuthor, extractDescription, extractCoverUrl, extractTags, extractStatus, extractChapterList, extractChapterImageUrls. Do not rename them to matchTitle, matchChapterList, or matchChapterImageUrls.
- Every extraction method must accept (document: unknown, sourceUrl: string) and use this.adapter.asCheerio(document) for DOM access.
- Do not implement fetchMetadata() or fetchChapterImages(); ComicCrawler runtime composes those from fine-grained functions.
- Keep all site-specific clicking, expansion, filtering, and extraction strategy visible in the adapter source.
- Helper functions are allowed, but keep them in the same TypeScript source file.
- Do not import from contracts/adapter-base-api.md, this.dom, browser document APIs, Capability imports, filesystem, child_process, process, eval, new Function, or arbitrary network side effects.
- Promotion mode: ${mode}. ${mode === 'augment' ? 'Keep the existing adapter id and add missing capability code.' : 'Create a new adapter implementation draft.'}
`;
}

export function extractRepresentativeChapterUrl(markdown: string, baseUrl: string): string {
  const match = /Representative Chapter URL\s*:?\s*(https?:\/\/\S+|\/\S+)/i.exec(markdown)
    ?? /representative chapter\s*:?\s*(https?:\/\/\S+|\/\S+)/i.exec(markdown);
  if (!match?.[1]) {
    throw new Error('Phase 1 output did not include a Representative Chapter URL.');
  }
  return new URL(match[1].replace(/[)>.,]+$/, ''), baseUrl).href;
}

export function validatePhase1Markdown(markdown: string): { valid: boolean; errors: string[] } {
  const requiredHeadings = [
    '## Site Decision',
    '## Title Extraction',
    '## Chapter List Extraction',
    '## Representative Chapter URL',
    '## Evidence',
    '## Uncertainty',
  ];
  const errors = requiredHeadings.filter((heading) => !markdown.includes(heading)).map((heading) => `Missing required Phase 1 heading: ${heading}`);
  if (/\bwaiting for\b|\bawait(?:ing)? (?:its|the|subagent|tool)|\bplan\b/i.test(markdown) && errors.length > 0) {
    errors.push('Phase 1 output appears to be a plan or waiting note rather than analysis.');
  }
  return { valid: errors.length === 0, errors };
}

export function extractFallbackChapterUrlFromHtml(html: string, baseUrl: string): string | undefined {
  const $ = cheerio.load(html);
  const candidates: string[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    const text = compactText($(element).text());
    const resolved = safeResolve(baseUrl, href);
    const signal = `${text} ${href} ${resolved}`;
    if (/chapter|episode|read|reader|viewer|\/manga\/[^/]+\/[^/]+/i.test(signal)) {
      candidates.push(resolved);
    }
  });
  return candidates.find((url) => url !== baseUrl);
}

export function createManifestMarkdown(candidate: ParsedMarkdownCandidate): string {
  return `# Reviewed Selector Manifest

## Adapter

- Adapter ID: ${candidate.adapterId ?? ''}
- Name: ${candidate.name ?? ''}
- Domains: ${candidate.domains.join(', ')}
- URL Patterns: ${candidate.urlPatterns.join(', ')}

## Selectors

- Metadata Title: ${candidate.selectors.metadata?.title ?? ''}
- Metadata Author: ${candidate.selectors.metadata?.author ?? ''}
- Metadata Cover: ${candidate.selectors.metadata?.cover ?? ''}
- Metadata Status: ${candidate.selectors.metadata?.status ?? ''}
- Metadata Tags: ${candidate.selectors.metadata?.tags ?? ''}
- Chapter List: ${candidate.selectors.chapters?.list ?? ''}
- Chapter Item: ${candidate.selectors.chapters?.item ?? ''}
- Chapter Title: ${candidate.selectors.chapters?.title ?? ''}
- Chapter URL: ${candidate.selectors.chapters?.url ?? ''}
- Image Container: ${candidate.selectors.images?.container ?? ''}
- Image Item: ${candidate.selectors.images?.item ?? ''}
- Image Source Attribute: ${candidate.selectors.images?.srcAttr ?? ''}
`;
}
