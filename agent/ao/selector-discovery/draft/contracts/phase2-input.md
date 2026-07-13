# Phase 2 Input Contract

ComicCrawler provides this task as Markdown. Do not expect JSON.

## Goal

Use Phase 1 results and representative chapter DOM evidence to write TypeScript
capability drafts plus Markdown review notes.

## Source URL

Original metadata/catalog URL or chapter URL.

## Capability Implementation Contract

The task includes the required capability contract summary. Follow it exactly.
Read `adapter-base-api.md` for imports, capability class usage, method
signatures, return shapes, helper methods, and parseMode meaning before writing
TypeScript.

## Phase 1 Result

Prior Markdown analysis from Phase 1.

## Representative Chapter DOM Summary

Sanitized, reduced chapter-page DOM evidence. It must represent the reader page,
not a metadata page, challenge page, recommendation card, or unrelated page.

Extraction functions must return complete arrays for the trusted DOM. Do not
return previews such as first chapters or first image URLs.

## Required Output

Write:

- the requested `outputs/*-capability.ts` file
- the requested `outputs/*-review.md` file

ComicCrawler assembles the final AdapterBase shell after review.
