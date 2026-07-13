# Capability Draft Output Contract

This legacy-named file describes capability draft review notes. Agents do not
write the final `AdapterBase` shell; ComicCrawler assembles it from reviewed
capability classes.

## TypeScript Capability Requirements

The requested TypeScript file must:

- contain only the capability class or classes requested for the current stage;
- create site-specific subclasses of `CommonCapability`,
  `VerificationCapability`, `MetadataCapability`, or
  `ChapterImagesCapability`;
- not export a class that extends `AdapterBase`;
- not declare adapter identity, domains, parseMode, capability flags, handler
  fields, constructors, or `super(...)`;
- implement fine-grained capability functions, not `fetchMetadata()` or
  `fetchChapterImages()`;
- keep site-specific expansion, filtering, and extraction logic visible in the
  capability source;
- return full extraction results from capability methods:
  - `extractChapterList` returns all catalog chapters visible in the trusted DOM;
  - `extractChapterImageUrls` returns all comic page image URLs visible in the
    trusted reader DOM;
- avoid filesystem access, child processes, `process`, `eval`, `new Function`,
  `this.dom`, browser document APIs, invalid `Capability` imports, and arbitrary
  side effects.

## Review Notes Requirements

Use these sections where relevant to the requested capability stage.

## Capability Scope

- Stage:
- Implemented capability class:
- Intentionally omitted capabilities:

## Implemented Functions

List every implemented fine-grained function and the evidence used.

## Metadata Evidence

For metadata stages, explain title, author, description, cover, tags, status,
and chapter-list evidence. If chapter-only, state that metadata is intentionally
not implemented.

## Chapter Image Evidence

For chapter image stages, explain reader containers, image nodes, lazy-loading
attributes, and why selected images are comic pages rather than covers, logos,
UI icons, tracking pixels, or ads.

## Verification Evidence

For verification stages, explain how blocked/challenge pages are detected. Do
not propose bypassing CAPTCHA or Cloudflare.

## Known Risks

List incomplete DOM evidence, collapsed chapter lists, dynamic rendering,
verified browser DOM requirements, and URL mismatch risks.

## Reviewer Checklist

- Capability subclass used:
- No AdapterBase shell:
- No constructor/super identity object:
- No this.dom or browser document API:
- No JSON output:
- No fetchMetadata/fetchChapterImages implementation:
- URL matching checked:
- Metadata functions checked:
- Chapter image functions checked:
- Verification handoff behavior checked:
