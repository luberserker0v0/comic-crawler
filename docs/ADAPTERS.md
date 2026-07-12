# ComicCrawler Adapters

Adapters are the site-specific boundary in ComicCrawler. They identify URLs,
declare capabilities, and implement fine-grained extraction functions. Runtime
code chooses the DOM source and calls those functions; site strategy should be
visible in the adapter implementation, not hidden in Adapter Lab or generic
runtime preparation code.

## Adapter contract

A site adapter extends `AdapterBase` and declares:

- identity: `id`, `name`, `domains`
- `parseMode`: `static`, `dynamic`, or `interactive`
- capabilities: `verification`, `metadata`, `chapterImages`
- fine-grained functions such as `extractTitle`, `extractChapterList`, and
  `extractChapterImageUrls`

`parseMode` only tells the runtime how to obtain the DOM:

- `static` - fetch HTML directly.
- `dynamic` - render the page with Playwright before parsing.
- `interactive` - render with Playwright and expect human verification handoff
  when the site blocks automation.

Adapters should not expose old large façade functions such as `fetchMetadata()`
or `fetchChapterImages()` as Agent-facing capabilities. ComicCrawler composes
metadata and image results internally from the fine-grained functions.

## Capabilities

- `metadata` means the adapter can extract manga catalog data and the chapter
  list from a manga URL.
- `chapterImages` means the adapter can extract image URLs from a chapter URL.
- `verification` means the adapter can participate in the human verification
  handoff flow. It does not mean ComicCrawler bypasses or cracks verification.

All-chapter tasks require both `metadata` and `chapterImages`. Specific-chapter
tasks require only `chapterImages`. A chapter-only adapter is valid, but it must
not claim metadata support until metadata extraction has been implemented and
reviewed.

## Adapter Lab

Adapter Lab is a human-facing review and diagnosis page.

The flow is:

1. Enter a URL.
2. Resolve the matching adapter.
3. Select an available capability.
4. Select a function.
5. Review the full adapter implementation or editable draft.
6. Run the selected function against the URL.

URL type locks the available extraction capability:

- Manga catalog URL: metadata functions are available.
- Chapter URL: chapter image functions are available.
- Common and verification functions remain available for diagnostics.

Adapter Lab does not secretly fix a page before calling a function. For example,
it does not scan and click generic "show all" or "more chapters" buttons outside
the adapter implementation. If a site needs special handling, that logic must be
visible in the adapter source or selector manifest being reviewed.

Function tests return a structured summary. `extractChapterImageUrls` returns
the complete `imageUrls` list, not a shortened `firstImageUrls` preview.

## Drafts

Adapter Lab can create user-owned editable drafts:

- Built-in TypeScript drafts can be saved, reset, diffed, and discarded, but are
  not executed yet.
- Dynamic manifest drafts can be tested through a temporary adapter without
  registering or promoting them.

Drafts are stored under the user data area, not in the Git-tracked repo source.
Discarding a draft removes that saved user copy.

## Fixtures and verified DOM

Verified fixtures are runtime artifacts captured from a real browser or handoff
session after verification. They are useful for diagnosis and repeatable local
testing, but they are not hand-written fake data and are not committed by
default.

Selector discovery and Adapter Lab tests must not use challenge, blocked, or
verification HTML as valid comic DOM.
