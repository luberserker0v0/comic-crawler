---
name: candidate-validation
description: Check a capability draft before developer review.
compatibility: opencode
metadata:
  project: ComicCrawler
---

## Check

- Requested subclass, methods, signatures, and review sections are present.
- No AdapterBase shell or methods from another capability.
- Results are complete for the supplied DOM and selectors exclude unrelated
  content.
- Evidence supports selectors; risks mention incomplete or dynamic DOM.
- No browser, filesystem, process, network, or dynamic-code side effects.
- Output remains TypeScript plus Markdown, never JSON.
