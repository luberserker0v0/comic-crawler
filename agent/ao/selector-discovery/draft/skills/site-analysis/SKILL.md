---
name: site-analysis
description: Analyze comic metadata and chapter pages to identify page role, content signals, and representative chapter links.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## What to do

- Identify whether the HTML is a metadata page, chapter list area, or reader page.
- Look for title, author, cover, status, tags, description, chapter list, and reader image signals.
- Choose one representative chapter URL that is likely to contain images.
- Check whether the chapter list appears collapsed or partial. Look for text or
  controls such as "more", "show all", "expand", "全部章节", "展开", or similar.
- Distinguish catalog chapter entries from shortcuts such as "start reading" or
  "continue reading".
- For reader pages, confirm that the DOM URL and page signals match a chapter
  reader page rather than a metadata/catalog page from the same domain.
- For sites that require human verification, analyze only verified comic DOM.
  Challenge, blocked, or verification pages are not valid selector sources.
- When evaluating image signals, group candidates into comic page images versus
  cover/logo/icon/UI/ad images.

## Output guidance

Explain observations in Markdown. Prefer concrete selector evidence over guesses.
If the chapter list may require expansion or the reader DOM may require a
verified browser session, state that in Evidence or Known Risks.
