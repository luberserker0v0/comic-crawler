# Phase 1 Input Contract

ComicCrawler provides this task as Markdown. Do not expect JSON.

## Goal

Analyze a manga metadata/catalog page and produce a Markdown Phase 1 result that
is useful for writing a TypeScript `AdapterBase` implementation.

## Source URL

The original manga metadata/catalog URL.

## Existing Adapter Capability

Optional. Present only when this run augments an existing same-domain adapter.
If present, keep the same adapter identity.

## Safe Fetch Summary

ComicCrawler-provided fetch summary, redirects, content type, and final URL.

## DOM Summary

Sanitized, reduced metadata-page DOM evidence. Treat it as the only trusted page
evidence for Phase 1.

For chapter-list analysis, reason about the full catalog visible in the trusted
DOM. Do not treat preview snippets, first chapters, or shortcut links as the
complete chapter list.

## Required Output

Write Markdown matching `phase1-output.md`.
