# AO Selector Discovery

AO creates reviewable adapter capability drafts from trusted DOM evidence.
ComicCrawler validates and assembles the final adapter; a developer must accept
it before promotion.

## Inputs

Each short-lived AO workspace receives:

- the selector-discovery agent, skills, templates, and Markdown contracts;
- `task.md` with the source URL, fetch summary, capability target, existing
  adapter context, and sanitized DOM summary;
- Phase 1 analysis when metadata discovery precedes chapter discovery;
- retry feedback from static validation when needed.

Provider configuration and credentials remain outside task artifacts.

## Capability pipeline

1. `common-verification`: URL matching and challenge handoff.
2. `metadata`: metadata and chapter catalog for full adapters.
3. `chapter-images`: ordered comic page image URLs.
4. System compose: ComicCrawler builds the final `AdapterBase` shell.

AO writes only the requested capability subclass and Markdown review notes.
Exact interfaces are defined in
`agent/ao/selector-discovery/draft/contracts/adapter-base-api.md`.

## Browser boundary

Browser Client navigates, waits, and runs bounded `scroll-through` content
preparation before ComicCrawler captures the DOM. AO and adapter capabilities
receive a Cheerio snapshot and perform pure extraction; they cannot click,
scroll, navigate, fetch, or use browser globals.

Virtualized reader URLs may be preserved in `data-comiccrawler-src` or
`data-comiccrawler-image-url` attributes in that snapshot.

If the DOM remains incomplete, AO records the evidence instead of inventing
missing chapters or image URLs. DOM readiness rejects known reader-page
containers that still contain unloaded placeholders.

## Review and promotion

Before developer acceptance, ComicCrawler checks:

- TypeScript syntax, capability structure, and exact method signatures;
- prohibited imports and side effects;
- challenge detection rules;
- fixture readiness and non-empty extraction;
- reader page count against extracted image count when the DOM exposes page
  containers.

Acceptance stores the page fixture and expected extraction result. Future tests
rerun the adapter against that fixture and compare the complete result.
The accepted TypeScript is stored as an immutable Adapter Package and activated
through the local Adapter Catalog. Promotion never overwrites an existing
package version.

## AO lifecycle

For every phase ComicCrawler:

1. creates a temporary conversation;
2. uploads the bundle and `task.md`;
3. invokes the `selector-discovery` agent with the caller-selected model;
4. reads and validates the requested files;
5. stores review artifacts;
6. deletes the conversation.
