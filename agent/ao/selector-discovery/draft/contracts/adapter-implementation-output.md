# Capability Draft Review

The TypeScript draft must contain only the requested site-specific capability
subclass. Follow `adapter-base-api.md`; ComicCrawler assembles the adapter shell.

Review notes use the relevant sections below:

## Capability Scope

- Stage:
- Implemented class:
- Omitted capabilities:

## Implemented Functions

List each method and its DOM evidence.

## Metadata Evidence

Explain field and chapter-list selectors when this is a metadata stage.

## Chapter Image Evidence

Explain the reader container, image nodes, URL attributes, ordering, and
non-comic exclusions when this is a chapter-image stage.

## Verification Evidence

Explain challenge detection without proposing a bypass.

## Known Risks

Record incomplete DOM, dynamic content, collapsed lists, URL mismatch, or weak
selector evidence. Browser preparation is upstream; capability code must not
perform browser actions.

## Reviewer Checklist

- Correct capability subclass and method signatures
- No AdapterBase shell or cross-capability methods
- No browser, filesystem, process, network, or dynamic-code side effects
- Complete ordered results for the supplied DOM
- Site-specific evidence and risks documented
