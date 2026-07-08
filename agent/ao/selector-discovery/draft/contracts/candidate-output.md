# Final Candidate Output Contract

Use these exact second-level headings. Do not rename them, do not add parenthetical suffixes, and do not replace them with prose headings.

## Adapter Identity

- Adapter ID:
- Name:

## URL Patterns

- Domains:
- Patterns:

## Metadata Selectors

- Title:
- Author:
- Cover:
- Status:
- Tags:
- Description:

For chapter-only discovery, write `Not required for chapter-only discovery.` for this section instead of inventing metadata selectors.

## Chapter Selectors

- List:
- Item:
- Title:
- URL:

For chapter-only discovery, write `Not required for chapter-only discovery.` for this section instead of inventing chapter-list selectors.

## Image Selectors

- Container:
- Item:
- Source Attribute:

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

- Metadata selectors checked:
- Chapter selectors checked:
- Image selectors checked:
- Image selectors exclude cover/logo/icon/UI/ad images:
- Representative chapter DOM matches representative chapter URL:
- No JSON output:
