---
name: site-analysis
description: Analyze comic metadata and chapter pages to identify page role, content signals, representative chapter links, and adapter implementation risks.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## What to do

- Identify whether the HTML is a metadata page, chapter list area, or reader page.
- Look for title, author, cover, status, tags, description, chapter list, and
  reader image signals.
- Choose one representative chapter URL that is likely to contain images.
- Check whether the chapter list appears collapsed or partial. Look for text or
  controls such as "more", "show all", "expand", "more chapters",
  "show older chapters", "更多", "展开", "展開", "全部章節",
  "全部章节", "目录", "目錄", or similar.
- Distinguish catalog chapter entries from shortcuts such as "start reading" or
  "continue reading".
- For reader pages, confirm that the DOM URL and page signals match a chapter
  reader page rather than a metadata/catalog page from the same domain.
- For sites that require human verification, analyze only verified comic DOM.
  Challenge, blocked, or verification pages are not valid adapter sources.
- When evaluating image signals, group candidates into comic page images versus
  cover/logo/icon/UI/ad images.
- Note any site-specific expansion, filtering, or data normalization logic that
  must be visible in the TypeScript adapter implementation.
- Treat chapter and image extraction as full-array extraction. Do not treat
  preview snippets, first chapters, first images, or sample lists as complete
  extraction results.

## Output guidance

Explain observations in Markdown. Prefer concrete DOM evidence over guesses.
If the chapter list may require expansion or the reader DOM may require a
verified browser session, state that in Evidence or Known Risks.
