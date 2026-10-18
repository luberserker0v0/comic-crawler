---
name: site-analysis
description: Identify comic page roles, content evidence, and adapter risks.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Analyze

- Identify metadata, catalog, reader, or challenge pages.
- Find metadata fields, catalog items, reader pages, and one representative
  chapter URL when required.
- Distinguish catalog entries from read/continue shortcuts.
- Distinguish comic pages from covers, logos, UI, ads, and tracking images.
- Flag collapsed catalogs, incomplete reader DOM, URL mismatch, or challenge
  content. Do not guess missing data.

Report concise Markdown backed by supplied DOM evidence.
