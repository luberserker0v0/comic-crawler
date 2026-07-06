import { describe, expect, it } from '@jest/globals';
import { parseMarkdownCandidate, validateMarkdownCandidate } from '../../../src/selector-discovery/markdown-candidate';

describe('Markdown candidate parser', () => {
  const candidate = `# Candidate

## Adapter Identity

- Adapter ID: example
- Name: Example

## URL Patterns

- Domains: example.com, www.example.com
- Patterns: https://example.com/manga/*

## Metadata Selectors

- Title: h1
- Author: main p
- Cover: img[itemprop="image"]
- Status: .status
- Tags: a[href*="genre="]
- Description: .description

## Chapter Selectors

- List: .chapter-list
- Item: a
- Title: a
- URL: a

## Image Selectors

- Container: .reader
- Item: img[data-original]
- Source Attribute: data-original

## Sample Extraction

Looks plausible.

## Evidence

Selectors match repeated nodes.

## Confidence

high

## Known Risks

none

## Reviewer Checklist

- No JSON output: yes
`;

  it('validates required Markdown headings', () => {
    expect(validateMarkdownCandidate(candidate)).toEqual({
      valid: true,
      missingHeadings: [],
      warnings: [],
    });
  });

  it('parses labeled selectors from Markdown sections', () => {
    const parsed = parseMarkdownCandidate(candidate);
    expect(parsed.adapterId).toBe('example');
    expect(parsed.domains).toEqual(['example.com', 'www.example.com']);
    expect(parsed.selectors.metadata?.title).toBe('h1');
    expect(parsed.selectors.images?.srcAttr).toBe('data-original');
  });

  it('rejects JSON-only output as invalid Markdown contract output', () => {
    const result = validateMarkdownCandidate('{"Adapter Identity":{"Adapter ID":"example"}}');
    expect(result.valid).toBe(false);
    expect(result.warnings).toContain('Candidate appears to be JSON-only output; Markdown sections are required.');
  });

  it('extracts a reviewable candidate from natural AO report headings', () => {
    const report = `# ComicCrawler Selector Discovery: Final Candidate Report

**Source URL Analyzed:** \`https://kuronavi.one/manga/an-haxing-jian-guo-jia-noe-de-ling-zhu\`

## Metadata Selectors (Manga Page)

- **Title:** \`h1\`
- **Cover Image:** \`img[class*="object-cover"][src$="/cover.jpg"]\`
- **Description:** \`.comic-detail p:first-of-type\`
- **Author:** \`span[title*="Author"]\`

## Chapter List Selectors (Manga Page)

- **Chapter List Container:** \`div#main-content\`
- **Individual Chapter Link:** \`a[href*="/chapter-"]\` within \`#main-content\`

## Image Selectors (Chapter Reader Page)

- **Primary Chapter Image Item:** \`img\`
- **Lazy-Loaded Image Item:** \`img[data-original]\`

## Summary of Findings & Confidence Assessment (Validation)

**Confidence:** **High**.
`;

    const result = validateMarkdownCandidate(report);
    const parsed = parseMarkdownCandidate(report);

    expect(result.valid).toBe(true);
    expect(result.missingHeadings).toContain('Adapter Identity');
    expect(parsed.adapterId).toBe('kuronavi-one');
    expect(parsed.domains).toContain('kuronavi.one');
    expect(parsed.selectors.metadata?.title).toBe('h1');
    expect(parsed.selectors.chapters?.list).toBe('div#main-content');
    expect(parsed.selectors.chapters?.url).toBe('a[href*="/chapter-"]');
    expect(parsed.selectors.images?.item).toBe('img[data-original]');
    expect(parsed.selectors.images?.srcAttr).toBe('data-original');
  });

  it('prefers lazy-loading image selectors when a separate lazy section is present', () => {
    const report = `**Source URL Analyzed:** \`https://kuronavi.one/manga/example\`

## Metadata Selectors

- **Title:** \`h1\`

## Chapter List Selectors

- **Chapter List Container:** \`#main-content\`
- **Individual Chapter Link:** \`a[href*="/chapter-"]\`

## Image Selectors

- **Primary Chapter Image Item:** \`img\`

## Image Lazy-Loading Candidates (For Optimization)

- **Lazy-Loaded Image Item:** \`img[data-original]\`
`;

    const parsed = parseMarkdownCandidate(report);
    expect(parsed.selectors.images?.item).toBe('img[data-original]');
    expect(parsed.selectors.images?.srcAttr).toBe('data-original');
  });

  it('accepts chapter-only candidates with image selectors but no metadata selectors', () => {
    const report = `**Source URL Analyzed:** \`https://example.com/manga/demo/chapter-1\`

## Image Selectors

- **Primary Chapter Image Item:** \`.reader img[data-src]\`
- **Source Attribute:** \`data-src\`
`;

    const result = validateMarkdownCandidate(report, { target: 'chapter-only' });
    const parsed = parseMarkdownCandidate(report);

    expect(result.valid).toBe(true);
    expect(parsed.selectors.metadata?.title).toBe('');
    expect(parsed.selectors.images?.item).toBe('.reader img[data-src]');
    expect(parsed.selectors.images?.srcAttr).toBe('data-src');
  });

  it('keeps full discovery candidates invalid when metadata/chapter selectors are missing', () => {
    const report = `**Source URL Analyzed:** \`https://example.com/manga/demo\`

## Image Selectors

- **Primary Chapter Image Item:** \`.reader img[data-src]\`
- **Source Attribute:** \`data-src\`
`;

    const result = validateMarkdownCandidate(report, { target: 'full' });

    expect(result.valid).toBe(false);
    expect(result.missingHeadings).toContain('Metadata Selectors');
    expect(result.missingHeadings).toContain('Chapter Selectors');
  });

  it('extracts selectors when the model emits each field as its own heading', () => {
    const report = `**Source URL Analyzed:** \`https://kuronavi.one/manga/example\`

## Adapter Identity

Kuronavi-style manga page.

## Metadata Selectors

## Title

- **Selector:** \`h1\`

## Description

- **Selector:** \`.description\`

## Cover Image URL

- **Selector:** \`img[src$="cover.jpg"]\`

## Chapter Selectors

## Chapter List Container

- **Selector:** \`.chapter-list\`

## Chapter Item

- **Selector:** \`a[href*="/chapter-"]\`

## Image Extraction Selectors (Chapter Page Specific)

## Image Item Selector

- **Selector:** \`.page-chapter img\`

## Image Source Attribute

- **Selector:** \`data-original\`
`;

    const result = validateMarkdownCandidate(report);
    const parsed = parseMarkdownCandidate(report);

    expect(result.valid).toBe(true);
    expect(parsed.selectors.metadata?.title).toBe('h1');
    expect(parsed.selectors.metadata?.cover).toBe('img[src$="cover.jpg"]');
    expect(parsed.selectors.chapters?.list).toBe('.chapter-list');
    expect(parsed.selectors.chapters?.url).toBe('a[href*="/chapter-"]');
    expect(parsed.selectors.images?.item).toBe('.page-chapter img');
    expect(parsed.selectors.images?.srcAttr).toBe('data-original');
  });
});
