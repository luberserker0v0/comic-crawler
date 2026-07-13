---
name: selector-extraction
description: Choose stable Cheerio-compatible selectors and extraction logic for ComicCrawler capability implementations.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Selector preferences

- Prefer semantic attributes, stable classes, itemprop, href patterns, and repeated containers.
- Avoid nth-child unless no stable alternative exists.
- Include source attributes for images, such as `data-original`, `data-src`, or `src`.
- Separate list/container selectors from item selectors.
- Treat full discovery as metadata/chapter-list discovery plus chapter image extraction.
- Treat chapter-only discovery as chapter image extraction only; do not invent metadata or chapter-list selectors.
- Treat chapter image extraction as a reusable unit. A full adapter should use
  the same image selector reasoning that would work for a direct chapter URL.
- Avoid broad final image selectors such as `body img` or `img[src]` unless the
  evidence shows the page contains only comic page images.
- Separate comic page images from non-comic images before choosing selectors.
  Non-comic images include covers, logos, browser/app promotion icons, UI assets,
  tracking pixels, and ads.
- Prefer reader containers and repeated lazy-loaded comic image nodes. Examples
  of useful attributes include `data-original`, `data-src`, `data-url`, `srcset`,
  and `src`.
- If image URLs show a clear comic CDN or path pattern, mention that pattern in
  Evidence or Known Risks so the reviewer can reject selectors that include UI
  assets.
- For metadata titles, prefer detail/title-specific selectors and Open Graph
  title metadata before falling back to a generic first `h1`.
- For chapter lists, reject navigation shortcuts such as "start reading" or
  "continue reading" when they point to one chapter but are not catalog entries.
- `extractChapterList` must return every catalog chapter visible in the trusted
  DOM, not a preview, sample, first page, first five entries, or UI shortcut.
- `extractChapterImageUrls` must return every comic page image visible in the
  trusted reader DOM, not `firstImageUrls` or a preview array.

## Implementation guidance

Use selectors inside visible TypeScript adapter functions. If helper functions
are useful, keep them in the same adapter source file so reviewers can see the
site-specific strategy.
Use `contracts/adapter-base-api.md` for exact capability method signatures and
return shapes.
