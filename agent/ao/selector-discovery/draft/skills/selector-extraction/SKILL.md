---
name: selector-extraction
description: Extract stable Cheerio-compatible CSS selectors for ComicCrawler metadata, chapter list, and image extraction.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Selector preferences

- Prefer semantic attributes, stable classes, itemprop, href patterns, and repeated containers.
- Avoid nth-child unless no stable alternative exists.
- Include source attributes for images, such as `data-original`, `data-src`, or `src`.
- Separate list/container selectors from item selectors.

## Markdown format

Use labeled Markdown lines such as:

- Title: h1
- List: .chapter-list
- Item: a
- Source Attribute: data-original

