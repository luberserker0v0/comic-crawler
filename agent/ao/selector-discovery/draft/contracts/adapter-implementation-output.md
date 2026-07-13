# Adapter Implementation Draft Output Contract

The final AO result has two files:

- `outputs/adapter-implementation.ts`
- `outputs/review-notes.md`

## TypeScript Implementation Requirements

The TypeScript file must:

- export exactly one site adapter class that extends `AdapterBase`;
- follow `contracts/adapter-base-api.md` for imports, capability class usage,
  method signatures, return shapes, helper usage, and parseMode meaning;
- declare `id`, `name`, `domains`, `parseMode`, and `capabilities`;
- declare adapter identity as readonly class fields, not constructor or
  `super(...)` options;
- implement site URL matching through `CommonCapability`;
- implement supported capability handlers using the `CommonCapability`,
  `VerificationCapability`, `MetadataCapability`, and `ChapterImagesCapability`
  classes exported by ComicCrawler;
- create site-specific capability subclasses; do not instantiate abstract/base
  capability classes directly;
- keep extraction methods inside capability subclasses, not directly on the
  adapter shell class;
- implement fine-grained extraction functions, not `fetchMetadata()` or
  `fetchChapterImages()`;
- keep site-specific expansion, filtering, and extraction logic visible in the
  adapter source;
- return full extraction results from capability methods:
  - `extractChapterList` returns all catalog chapters visible in the trusted DOM;
  - `extractChapterImageUrls` returns all comic page image URLs visible in the
    trusted reader DOM;
- avoid filesystem access, child processes, `process`, `eval`, `new Function`,
  `this.dom`, browser document APIs, invalid `Capability` imports, and arbitrary
  side effects.

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
- AdapterBase API reference followed:
- Identity declared as readonly fields:
- No constructor/super identity object:
- Capability subclasses used:
- Extraction methods are not on adapter shell:
- No this.dom or browser document API:
- No JSON output:
- No fetchMetadata/fetchChapterImages implementation:
- URL matching checked:
- Metadata functions checked:
- Chapter image functions checked:
- Verification handoff behavior checked:
