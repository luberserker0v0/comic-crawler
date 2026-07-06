import * as cheerio from 'cheerio';
import type { SafeHtmlFetchResult } from './safe-fetch';
import type { ParsedMarkdownCandidate } from './types';

export function createPhase1TaskMarkdown(input: { url: string; metadataFetch: SafeHtmlFetchResult }): string {
  return `# Selector Discovery Phase 1

## Goal

Analyze the comic metadata page and discover stable selectors for metadata and chapter list extraction.

Important rules:

- Write Markdown only.
- Do not output JSON.
- Do not generate adapter code.
- Use divide-and-conquer. Do not try to reason over the whole HTML at once.

## Source URL

${input.url}

## Safe Fetch Summary

- Final URL: ${input.metadataFetch.finalUrl}
- Content-Type: ${input.metadataFetch.contentType || 'unknown'}
- Redirects: ${input.metadataFetch.redirectChain.length === 0 ? 'none' : input.metadataFetch.redirectChain.join(' -> ')}

## DOM Summary

${summarizeHtmlForAgent(input.metadataFetch.html, input.metadataFetch.finalUrl, 'metadata')}

## HTML Analysis Plan

Analyze in this order:

1. Identify the primary content container.
2. Analyze metadata signals: title, author, cover, status, tags, and description.
3. Analyze chapter-list signals: list container, chapter item, chapter title, and chapter URL.
4. Choose one representative chapter URL that is likely to contain reader images.
5. Write the output using the Markdown outline in contracts/phase1-output.md.
`;
}

export function createPhase2TaskMarkdown(input: {
  url: string;
  phase1Markdown: string;
  chapterFetch: SafeHtmlFetchResult;
}): string {
  return `# Selector Discovery Phase 2

## Goal

Use the Phase 1 result and the representative chapter page to produce a final human-reviewable Markdown selector candidate.

Important rules:

- Write Markdown only.
- Do not output JSON.
- Do not generate adapter code.
- Use divide-and-conquer. Analyze image containers and lazy-loading attributes separately.

## Source URL

${input.url}

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
3. Choose image item selector and source attribute.
4. Combine the Phase 1 selectors with the image selectors.
5. Write the final output using the Markdown outline in contracts/candidate-output.md.
`;
}

export function extractRepresentativeChapterUrl(markdown: string, baseUrl: string): string {
  const match = /Representative Chapter URL\s*:?\s*(https?:\/\/\S+|\/\S+)/i.exec(markdown)
    ?? /representative chapter\s*:?\s*(https?:\/\/\S+|\/\S+)/i.exec(markdown);
  if (!match?.[1]) {
    throw new Error('Phase 1 output did not include a Representative Chapter URL.');
  }
  return new URL(match[1].replace(/[)>.,，。]+$/, ''), baseUrl).href;
}

export function extractFallbackChapterUrlFromHtml(html: string, baseUrl: string): string | undefined {
  const $ = cheerio.load(html);
  const candidates: string[] = [];
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    const text = compactText($(element).text());
    const resolved = safeResolve(baseUrl, href);
    const signal = `${text} ${href} ${resolved}`;
    if (/chapter|episode|read|第|話|\/manga\/[^/]+\/[^/]+/i.test(signal)) {
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
  const headings = collect($, 'h1,h2,h3', (el) => compactText($(el).text()), 40);
  const meta = collect($, 'meta[name],meta[property],meta[itemprop]', (el) => {
    const node = $(el);
    const key = node.attr('name') ?? node.attr('property') ?? node.attr('itemprop') ?? '';
    const value = node.attr('content') ?? '';
    return `${key}: ${value}`;
  }, 40);
  const anchors = collect($, 'a[href]', (el) => {
    const node = $(el);
    const href = node.attr('href') ?? '';
    const text = compactText(node.text());
    return `${text || '(no text)'} -> ${safeResolve(baseUrl, href)}`;
  }, pageType === 'metadata' ? 120 : 50, (value) => /chapter|manga|comic|read|episode|ep|第|話/i.test(value));
  const images = collect($, 'img,source', (el) => {
    const node = $(el);
    const attrs = ['src', 'data-src', 'data-original', 'data-lazy-src', 'srcset']
      .map((attr) => node.attr(attr) ? `${attr}=${node.attr(attr)}` : '')
      .filter(Boolean)
      .join(' ');
    const className = node.attr('class') ? ` class=${node.attr('class')}` : '';
    return `${node[0]?.tagName ?? 'img'}${className} ${attrs}`.trim();
  }, pageType === 'chapter' ? 160 : 60);
  const structuralCandidates = collect($, 'main,article,section,div[class],ul[class],ol[class]', (el) => {
    const node = $(el);
    const tag = node[0]?.tagName ?? 'node';
    const id = node.attr('id') ? `#${node.attr('id')}` : '';
    const className = node.attr('class') ? `.${node.attr('class')!.trim().split(/\s+/).slice(0, 4).join('.')}` : '';
    const text = compactText(node.clone().children().remove().end().text());
    const childSummary = summarizeChildren(node);
    return `${tag}${id}${className} | children=${childSummary} | text=${text.slice(0, 120)}`;
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
