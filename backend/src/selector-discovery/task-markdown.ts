import * as cheerio from 'cheerio';
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
  const composeStageNumber = input.target === 'full' ? '5' : '4';
  return `## Capability Pipeline

Generate adapter behavior in capability stages. Do not treat discovery as one
large unstructured adapter-writing task.

1. CommonCapability: match supported URLs and reject unrelated domains/paths.
2. VerificationCapability: always implement this capability. It detects blocked
   or challenge DOM and describes the official human handoff. Normal pages may
   return false, but the capability still exists because it gates DOM trust.
${metadataStage}
${chapterStageNumber}. ChapterImagesCapability: extract all comic page image URLs from trusted reader DOM.
${composeStageNumber}. Compose: assemble the site adapter shell from reviewed capability handlers.

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

Analyze the comic metadata page and discover the site behavior needed to write a TypeScript AdapterBase implementation.

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

Use the Phase 1 result and the representative chapter page to produce a human-reviewable TypeScript AdapterBase implementation draft plus Markdown review notes.

Important rules:

- Write Markdown only.
- Do not output JSON.
- Generate TypeScript adapter code only in the requested implementation file.
- The implementation must export one adapter class that extends AdapterBase.
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
5. Combine the Phase 1 findings with chapter image URL extraction in a TypeScript adapter implementation.
6. Write review notes using contracts/adapter-implementation-output.md.
7. Write TypeScript source to outputs/adapter-implementation.ts.
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

Analyze a comic reader chapter page and produce a chapter-only TypeScript AdapterBase implementation draft.

This target implements only chapter image URL extraction:

- Metadata extraction functions are not required.
- Chapter list extraction is not required.
- Chapter Image URL Extraction is required.
- Write Markdown only.
- Do not output JSON.
- Generate TypeScript adapter code only in the requested implementation file.
- The implementation must export one adapter class that extends AdapterBase.
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
6. Write review notes using contracts/adapter-implementation-output.md.
7. Write TypeScript source to outputs/adapter-implementation.ts.
`;
}

function adapterImplementationContract(mode: 'create' | 'augment', target: 'full' | 'chapter-only' = 'full'): string {
  const metadataRequirement = target === 'chapter-only'
    ? '- Do not declare metadata capability unless metadata functions are actually implemented.'
    : '- Implement metadata extraction: extractTitle, extractAuthor, extractDescription, extractCoverUrl, extractTags, extractStatus, and extractChapterList.';
  return `## AdapterBase Implementation Contract

- Output one TypeScript source file at outputs/adapter-implementation.ts.
- Export exactly one site adapter class that extends AdapterBase.
- Read and follow contracts/adapter-base-api.md for imports, capability class
  usage, method signatures, return shapes, helper methods, and parseMode meaning.
- Discovery is capability-staged. Always produce CommonCapability and
  VerificationCapability first; VerificationCapability gates whether the DOM is
  trusted for later metadata or chapter-image extraction.
- Import AdapterBase and capability classes from ComicCrawler adapter base.
- Declare id, name, domains, parseMode, and capabilities.
- Declare adapter identity as readonly class fields. Do not pass id/name/domains/parseMode/capabilities to constructor or super().
- Capabilities must be boolean flags: { verification: true, metadata: boolean, chapterImages: boolean }.
- Capability handler instances must be separate readonly fields named common, verification, metadata, and chapterImages.
- Do not instantiate CommonCapability, VerificationCapability, MetadataCapability, or ChapterImagesCapability directly. Create site-specific subclasses that extend them.
- Do not write extraction methods directly on the adapter shell class; put them in the site-specific capability subclasses.
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

function summarizeHtmlForAgent(html: string, baseUrl: string, pageType: 'metadata' | 'chapter'): string {
  const $ = cheerio.load(html);
  const title = compactText($('title').first().text());
  const bodyClasses = $('body').attr('class') ?? '';
  const headings = collect($, 'h1,h2,h3', (el) => `${describeElementSelector($, el)} | text=${compactText($(el).text())}`, 40);
  const meta = collect($, 'meta[name],meta[property],meta[itemprop]', (el) => {
    const node = $(el);
    const key = node.attr('name') ?? node.attr('property') ?? node.attr('itemprop') ?? '';
    const value = node.attr('content') ?? '';
    return `${describeElementSelector($, el)} | ${key}: ${value}`;
  }, 40);
  const anchors = collect($, 'a[href]', (el) => {
    const node = $(el);
    const href = node.attr('href') ?? '';
    const text = compactText(node.text());
    return `${describeElementSelector($, el)} | text=${text || '(no text)'} | href=${safeResolve(baseUrl, href)}`;
  }, pageType === 'metadata' ? 120 : 50, (value) => /chapter|manga|comic|read|reader|viewer|episode|ep/i.test(value));
  const images = collect($, 'img,source', (el) => {
    const node = $(el);
    const attrs = ['src', 'data-src', 'data-original', 'data-lazy-src', 'srcset']
      .map((attr) => node.attr(attr) ? `${attr}=${node.attr(attr)}` : '')
      .filter(Boolean)
      .join(' ');
    const className = node.attr('class') ? ` class=${node.attr('class')}` : '';
    return `${describeElementSelector($, el)} | ${node[0]?.tagName ?? 'img'}${className} ${attrs}`.trim();
  }, pageType === 'chapter' ? 160 : 60);
  const structuralCandidates = collect($, 'main,article,section,div[class],ul[class],ol[class]', (el) => {
    const node = $(el);
    const tag = node[0]?.tagName ?? 'node';
    const id = node.attr('id') ? `#${node.attr('id')}` : '';
    const className = node.attr('class') ? `.${node.attr('class')!.trim().split(/\s+/).slice(0, 4).join('.')}` : '';
    const text = compactText(node.clone().children().remove().end().text());
    const childSummary = summarizeChildren(node);
    return `${describeElementSelector($, el)} | node=${tag}${id}${className} | children=${childSummary} | text=${text.slice(0, 120)}`;
  }, 140, (value) => /chapter|manga|comic|read|page|detail|content|list|episode|image|img|book|doc|main|article|section|box/i.test(value));

  return `### DOM Overview

- URL: ${baseUrl}
- Document title: ${title || 'unknown'}
- Body classes: ${bodyClasses || 'none'}
- Original HTML length: ${html.length} characters

### Headings

${formatList(headings)}

### Metadata-like Meta Tags

${formatList(meta)}

### Candidate Links

${formatList(anchors)}

### Candidate Image Nodes

${formatList(images)}

### Candidate Structural Containers

${formatList(structuralCandidates)}
`;
}

function collect(
  $: cheerio.CheerioAPI,
  selector: string,
  map: (element: any) => string,
  limit: number,
  filter?: (value: string) => boolean
): string[] {
  const values: string[] = [];
  $(selector).each((_, element) => {
    if (values.length >= limit) return false;
    const value = map(element).trim();
    if (!value) return;
    if (filter && !filter(value)) return;
    values.push(value);
    return;
  });
  return values;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeResolve(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function describeElementSelector($: cheerio.CheerioAPI, element: any): string {
  const path: string[] = [];
  let current = $(element);
  for (let depth = 0; depth < 4 && current.length > 0; depth += 1) {
    const node = current.first();
    const raw = node.get(0);
    if (!raw || raw.type === 'root') break;
    const tag = raw.tagName ?? 'node';
    const id = node.attr('id');
    const className = node.attr('class');
    const attrSelector = selectorAttributeHint(node);
    const classSelector = className
      ? `.${className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map(cssEscapeLite).join('.')}`
      : '';
    path.unshift(`${tag}${id ? `#${cssEscapeLite(id)}` : ''}${classSelector}${attrSelector}`);
    current = node.parent();
  }
  return path.join(' > ') || 'unknown';
}

function selectorAttributeHint(node: cheerio.Cheerio<any>): string {
  for (const attr of ['href', 'src', 'data-src', 'data-original', 'property', 'name', 'itemprop']) {
    const value = node.attr(attr);
    if (!value) continue;
    if (attr === 'href') {
      const stable = value.split('?')[0] ?? value;
      const segment = stable.split('/').filter(Boolean).at(0);
      return segment ? `[href*="/${cssEscapeLite(segment)}/"]` : '[href]';
    }
    if (['property', 'name', 'itemprop'].includes(attr)) {
      return `[${attr}="${cssEscapeLite(value)}"]`;
    }
    return `[${attr}]`;
  }
  return '';
}

function cssEscapeLite(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, '.');
}

function summarizeChildren(node: cheerio.Cheerio<any>): string {
  const counts = new Map<string, number>();
  node.children().each((_, child) => {
    const key = child.tagName ?? 'node';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries()).slice(0, 6).map(([key, count]) => `${key}:${count}`).join(',') || 'none';
}

function formatList(values: string[]): string {
  if (values.length === 0) return '- none';
  return values.map((value) => `- ${value}`).join('\n');
}
