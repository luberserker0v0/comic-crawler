# Final Candidate Output Contract

Use these exact second-level headings. Do not rename them, do not add parenthetical suffixes, and do not replace them with prose headings.

## Adapter Identity

- Adapter ID:
- Name:

## URL Patterns

- Domains:
- Patterns:

## Title Extraction

- Selector:
- Attribute:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Author Extraction

- Selector:
- Attribute:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Description Extraction

- Selector:
- Attribute:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Cover URL Extraction

- Selector:
- Attribute:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Tags Extraction

- Selector:
- Attribute:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Status Extraction

- Selector:
- Attribute:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Chapter List Extraction

- List Selector:
- Item Selector:
- Title Selector:
- URL Selector:
- Evidence:
- Risk:

For chapter-only discovery, write `Not required for chapter-only discovery.`

## Chapter Image URL Extraction

- Container:
- Item:
- Source Attribute:
- Evidence:
- Risk:

This section is required for both full and chapter-only discovery.

## Sample Extraction

Summarize expected extracted title, chapter count signal, and image count signal.
For full discovery, mention the representative chapter URL used for image
selector analysis.

## Evidence

Explain why the selectors match the provided HTML.
Also explain why selected image nodes are comic page images rather than covers,
logos, browser/app promotion icons, UI assets, tracking pixels, or ads.
If relevant, mention comic CDN or path patterns used as evidence.

## Confidence

Use high, medium, or low and explain why.

## Known Risks

List brittle assumptions or unresolved site behavior.
Include collapsed chapter lists, lazy-loaded images, verified browser DOM
requirements, URL mismatch risk between catalog and chapter pages, and CDN/path
assumptions when relevant.

## Reviewer Checklist

- Title extraction checked:
- Chapter list extraction checked:
- Chapter image URL extraction checked:
- Image selectors exclude cover/logo/icon/UI/ad images:
- Representative chapter DOM matches representative chapter URL:
- No JSON output:
