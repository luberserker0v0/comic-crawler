import { describe, expect, it } from '@jest/globals';
import { DynamicSiteAdapter, type DynamicSiteAdapterManifest } from '../../../src/adapter/dynamic-site-adapter';
import { parseMarkdownCandidate, validateMarkdownCandidate } from '../../../src/selector-discovery/markdown-candidate';

const HAPPYMH_SELF_AO_CANDIDATE = `# HappyMH Selector Candidate

## Adapter Identity

- Adapter ID: happymh
- Name: HappyMH

## URL Patterns

- Domains: m.happymh.com
- Patterns: https://m.happymh.com/manga/*, https://m.happymh.com/mangaread/*/*

## Metadata Selectors

- Title: h1, .detail-title, meta[property="og:title"]
- Author: .detail-author, .author
- Cover: meta[property="og:image"], .detail-cover img, .cover img
- Status: .status
- Tags: .tags a, .tag a
- Description: meta[name="description"], .detail-desc, .description

## Chapter Selectors

- List: .chapter-list, .catalog-list, body
- Item: a[href*="/mangaread/"]
- Title: a[href*="/mangaread/"]
- URL: a[href*="/mangaread/"]

## Image Selectors

- Container: #cp_img, #cp_image, .reader, .chapter-content, body
- Item: img[data-original], img[data-src], img[src]
- Source Attribute: data-original

## Sample Extraction

The metadata page exposes a title, repeated mangaread links, and a representative reader page with image nodes.

## Evidence

The selectors are derived from the Markdown DOM summaries that expose detail-title, chapter-list anchors, and reader image nodes.

## Confidence

medium; HappyMH requires a verified browser DOM and may vary lazy-load image attributes.

## Known Risks

The site may change reader containers or move image URLs into scripts.

## Reviewer Checklist

- Metadata selectors checked: yes
- Chapter selectors checked: yes
- Image selectors checked: yes
- No JSON output: yes
`;

describe('HappyMH Self-AO candidate', () => {
  it('validates and promotes to a full dynamic adapter manifest shape', () => {
    const validation = validateMarkdownCandidate(HAPPYMH_SELF_AO_CANDIDATE, { target: 'full' });
    const parsed = parseMarkdownCandidate(HAPPYMH_SELF_AO_CANDIDATE);

    expect(validation.valid).toBe(true);
    expect(parsed.adapterId).toBe('happymh');
    expect(parsed.domains).toContain('m.happymh.com');
    expect(parsed.selectors.metadata?.title).toContain('h1');
    expect(parsed.selectors.chapters?.url).toBe('a[href*="/mangaread/"]');
    expect(parsed.selectors.images?.item).toContain('img[data-original]');

    const selectors: DynamicSiteAdapterManifest['selectors'] = {
      metadata: parsed.selectors.metadata,
      chapters: parsed.selectors.chapters,
      images: parsed.selectors.images!,
    };

    const adapter = new DynamicSiteAdapter({
      adapterId: parsed.adapterId!,
      name: parsed.name!,
      domains: parsed.domains,
      urlPatterns: parsed.urlPatterns,
      capabilities: { verification: true, metadata: true, chapterImages: true },
      selectors,
      sourceDiscoveryId: 'self-ao-happymh',
      promotedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(adapter.capabilities).toEqual({ verification: true, metadata: true, chapterImages: true });
    expect(adapter.matchUrl('https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu')).toBe(true);
    expect(adapter.matchUrl('https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871')).toBe(true);
  });
});
