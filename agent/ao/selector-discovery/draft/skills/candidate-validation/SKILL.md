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

## Hard rule

Do not convert the candidate to JSON.
