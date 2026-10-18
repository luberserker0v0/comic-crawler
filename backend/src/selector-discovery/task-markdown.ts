import * as cheerio from 'cheerio';
import { compactText, safeResolve, summarizeHtmlForAgent } from './html-summary';
import type { SafeHtmlFetchResult } from './safe-fetch';
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
    ? '3. MetadataCapability: metadata plus the complete catalog in the supplied DOM.'
    : '3. MetadataCapability: skipped.';
  const chapterStageNumber = input.target === 'full' ? '4' : '3';
  return `## Capability Pipeline

1. CommonCapability: supported URL matching.
2. VerificationCapability: challenge detection and human handoff.
${metadataStage}
${chapterStageNumber}. ChapterImagesCapability: every comic page URL in the supplied reader DOM.

Browser preparation and readiness checks happen before extraction. Capability
code is pure DOM extraction and must not click, scroll, or navigate.

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

- Output final Markdown analysis, not JSON, code, a plan, or a waiting note.
- Analyze each field separately.
- Exclude read/continue shortcuts from the catalog.
- Flag collapsed or incomplete catalogs; do not invent missing chapters.

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

- Write requested TypeScript drafts and Markdown notes only; no JSON or
  AdapterBase shell.
- Confirm this is the representative reader URL.
- Use the reusable chapter-image capability for direct and full crawling.
- Prefer reader containers and lazy-load/CDN signals over broad image selectors.
- Return every comic page URL present; exclude covers, logos, UI, ads, and
  tracking pixels.
- If the reader DOM is incomplete after upstream preparation, record the risk.

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
- Write only requested TypeScript drafts and Markdown notes; no JSON or
  AdapterBase shell.
- Confirm this is the requested reader URL.
- Use reader containers and lazy-load/CDN signals, not broad image selectors.
- Return every comic page URL present; exclude non-comic images.
- Report incomplete DOM evidence instead of inventing URLs.

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

`;
}

function adapterImplementationContract(mode: 'create' | 'augment', target: 'full' | 'chapter-only' = 'full'): string {
  const metadataRequirement = target === 'chapter-only'
    ? '- Do not declare metadata capability unless metadata functions are actually implemented.'
    : '- Implement metadata extraction: extractTitle, extractAuthor, extractDescription, extractCoverUrl, extractTags, extractStatus, and extractChapterList.';
  return `## Capability Implementation Contract

- Follow \`contracts/adapter-base-api.md\` and \`contracts/capability-pipeline.md\`.
- Output only the requested site-specific capability subclass and review notes.
- ComicCrawler assembles the AdapterBase shell; do not declare its identity,
  wiring, constructor, or capability flags.
- Common matches URLs. Verification detects challenges and describes handoff;
  it never bypasses CAPTCHA.
${metadataRequirement}
- Chapter images use \`extractChapterImageUrls\`.
- Extraction methods accept \`(document: unknown, sourceUrl: string)\` and use
  \`this.adapter.asCheerio(document)\`.
- Browser preparation is upstream. Capability code must not click, scroll,
  navigate, fetch, or use side-effect APIs.
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
