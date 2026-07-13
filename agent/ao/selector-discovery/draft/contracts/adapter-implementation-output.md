# Adapter Implementation Draft Output Contract

The final AO result has two files:

- `outputs/adapter-implementation.ts`
- `outputs/review-notes.md`

## TypeScript Implementation Requirements

The TypeScript file must:

- export exactly one site adapter class that extends `AdapterBase`;
- declare `id`, `name`, `domains`, `parseMode`, and `capabilities`;
- implement site URL matching through `CommonCapability`;
- implement supported capability handlers using the `CommonCapability`,
  `VerificationCapability`, `MetadataCapability`, and `ChapterImagesCapability`
  classes exported by ComicCrawler;
- implement fine-grained extraction functions, not `fetchMetadata()` or
  `fetchChapterImages()`;
- keep site-specific expansion, filtering, and extraction logic visible in the
  adapter source;
- avoid filesystem access, child processes, `process`, `eval`, `new Function`,
  and arbitrary side effects.

## Review Notes Requirements

Use these exact headings in `outputs/review-notes.md`.

## Adapter Identity

- Adapter ID:
- Name:
- Domains:
- Parse Mode:
- Capabilities:

## Implemented Functions

List every implemented fine-grained function and the evidence used.

## Metadata Evidence

Explain title, author, description, cover, tags, status, and chapter-list
evidence. If chapter-only, state that metadata is intentionally not implemented.

## Chapter Image Evidence

Explain reader containers, image nodes, lazy-loading attributes, and why selected
images are comic pages rather than covers, logos, UI icons, tracking pixels, or
ads.

## Verification Evidence

Explain whether the adapter declares verification support and how it detects
blocked/challenge pages. Do not propose bypassing CAPTCHA or Cloudflare.

## Known Risks

List incomplete DOM evidence, collapsed chapter lists, dynamic rendering,
verified browser DOM requirements, and URL mismatch risks.

## Reviewer Checklist

- Adapter extends AdapterBase:
- No JSON output:
- No fetchMetadata/fetchChapterImages implementation:
- URL matching checked:
- Metadata functions checked:
- Chapter image functions checked:
- Verification handoff behavior checked:
