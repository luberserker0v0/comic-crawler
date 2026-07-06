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
- Metadata selectors include title, author, cover, status, tags, and optional description.
- Chapter selectors include list, item, title, and URL.
- Image selectors include item and source attribute.
- Evidence explains why the selectors match the provided HTML.
- Confidence states high, medium, or low with reasons.

## Hard rule

Do not convert the candidate to JSON.

