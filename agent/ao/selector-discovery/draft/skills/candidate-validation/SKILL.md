---
name: candidate-validation
description: Validate TypeScript AdapterBase implementation drafts and Markdown review notes for completeness, evidence, and reviewer readiness.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Checklist

- Required review-note sections are present.
- Adapter identity, domains, parseMode, and capabilities are understandable.
- TypeScript exports one adapter class that extends `AdapterBase`.
- The implementation uses fine-grained capability functions, not `fetchMetadata()` or `fetchChapterImages()`.
- For full discovery, metadata functions cover title, author, cover, status, tags, optional description, and chapter list.
- For chapter-only discovery, metadata and chapter-list behavior are explicitly not implemented.
- Chapter image extraction is implemented for both full and chapter-only discovery.
- Evidence explains why the implementation logic matches the provided HTML.
- Confidence states high, medium, or low with reasons.
- For full discovery, the image selectors must be compatible with the reusable
  chapter-only image extraction unit.
- Reject or warn on image selectors that are too broad, such as `body img` or
  `img[src]`, unless the Evidence proves the page contains only comic page
  images.
- Check that image selectors exclude covers, logos, browser/app promotion icons,
  UI assets, tracking pixels, and ads.
- Check that metadata title selectors prefer comic detail title signals instead
  of unrelated page headings such as rating widgets.
- Check that chapter selectors do not treat navigation shortcuts like "start
  reading" or "continue reading" as ordinary catalog entries.
- Check whether Known Risks mentions collapsed chapter lists, lazy-loaded reader
  images, verified browser DOM requirements, and CDN/path assumptions when those
  signals appear in the task summary.

## Hard rules

- Do not convert the draft to JSON.
- Do not approve code that uses filesystem access, child processes, `process`, `eval`, `new Function`, or hidden side effects.
