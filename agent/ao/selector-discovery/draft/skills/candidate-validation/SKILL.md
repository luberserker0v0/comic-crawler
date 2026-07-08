---
name: candidate-validation
description: Validate Markdown selector candidates for completeness, confidence, evidence, and reviewer readiness.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Checklist

- Required sections are present.
- Adapter identity and URL patterns are understandable.
- For full discovery, metadata selectors include title, author, cover, status, tags, and optional description.
- For full discovery, chapter selectors include list, item, title, and URL.
- For chapter-only discovery, metadata and chapter selectors are explicitly marked not required.
- Image selectors include item and source attribute for both full and chapter-only discovery.
- Evidence explains why the selectors match the provided HTML.
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

## Hard rule

Do not convert the candidate to JSON.
