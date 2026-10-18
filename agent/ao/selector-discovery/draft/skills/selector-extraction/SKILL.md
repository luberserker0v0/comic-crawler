---
name: selector-extraction
description: Choose stable Cheerio selectors for ComicCrawler capabilities.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Choose selectors

- Prefer semantic attributes, stable classes, repeated containers, and URL
  patterns; avoid `nth-child` and broad `body img`/`img[src]` selectors.
- Separate containers, items, and values.
- For images prefer reader nodes and `data-original`, `data-src`, `data-url`,
  `srcset`, then `src`.
- Return every catalog chapter or comic page present in the supplied DOM.
- Exclude shortcuts and non-comic images; deduplicate while preserving order.
- Keep site-specific helpers in the stage source for review.

Use `contracts/adapter-base-api.md` for signatures and return types.
