# Adapter Capability Pipeline

Use this contract whenever ComicCrawler asks you to produce adapter TypeScript.

Do not write a whole adapter as one unstructured block. Produce and reason
about adapter behavior in capability stages. ComicCrawler may ask for one stage
at a time. ComicCrawler, not the agent, assembles the final AdapterBase shell
from reviewed capability classes.

## Stage Order

1. `common-verification`
   - Implement only one `CommonCapability` subclass and one
     `VerificationCapability` subclass.
   - Follow `contracts/common-verification-template.ts`. Copy its structure and
     replace URL matching and verification keywords.
   - Do not declare or redefine `AdapterBase`, `CommonCapability`, or
     `VerificationCapability`.
   - Do not export or implement an `AdapterBase` shell in this stage.
   - Do not declare identity fields, capability flags, constructors, or handler
     wiring in this stage.
   - Do not add metadata or chapter image methods in this stage.
   - Implement `CommonCapability.matchUrl`.
   - Implement `VerificationCapability.detectVerificationRequired`.
   - Implement `VerificationCapability.describeVerificationHandoff`.
   - This stage is required for every adapter, even when no verification is
     observed. In that case detection returns `false` for normal pages and true
     for generic blocked/challenge signals.
2. `metadata`
   - Required for full adapters.
   - Implement only `MetadataCapability`.
   - Follow `contracts/metadata-template.ts`. Copy its structure and replace
     selectors, cleanup logic, URL filters, and status keywords with
     site-specific behavior.
   - The selectors in `metadata-template.ts` are placeholders. Do not keep them
     unless task evidence explicitly shows the same selectors on the target
     site.
   - Extract title, author, description, cover URL, tags, status, and the full
     chapter list from trusted metadata DOM.
   - Do not export an adapter shell in this stage.
   - Do not implement chapter image extraction in this stage.
3. `chapter-images`
   - Required for every chapter-capable adapter.
   - Implement only `ChapterImagesCapability`.
   - Extract all comic page image URLs from trusted reader DOM.
4. System compose
   - ComicCrawler assembles reviewed capability handlers into one `AdapterBase`
     site adapter. Agents do not write this shell.

## Boundaries

- `VerificationCapability` is the DOM trust gate. Later stages must assume the
  supplied DOM has already passed verification/readiness checks.
- Capability handlers are mutually scoped. Metadata code must not implement
  image extraction. Chapter image code must not implement metadata extraction.
- Do not combine capability handlers. For example, do not write
  `class SiteCommonVerificationCapability extends CommonCapability implements
  VerificationCapability`. Instead, write one site-specific subclass per
  capability base class:
  - `class SiteCommonCapability extends CommonCapability`
  - `class SiteVerificationCapability extends VerificationCapability`
  - `class SiteMetadataCapability extends MetadataCapability`
  - `class SiteChapterImagesCapability extends ChapterImagesCapability`
- If a site needs special expansion, filtering, or cleanup, put that logic in
  the relevant capability source so humans can review it.
- Do not add hidden generic browser actions outside the adapter source.
- Do not implement `fetchMetadata()` or `fetchChapterImages()`. ComicCrawler
  composes those internally from fine-grained capability methods.
- Do not output JSON.

## Stage Output Files

When asked for staged output, use these paths:

- `outputs/common-verification.ts`
- `outputs/common-verification-review.md`
- `outputs/metadata-capability.ts`
- `outputs/metadata-review.md`
- `outputs/chapter-images-capability.ts`
- `outputs/chapter-images-review.md`
- `outputs/review-notes.md`

If the task message names a narrower set of output files, write only those files.

## File Write Protocol

When ComicCrawler asks you to write a source file and a review file:

- Write the TypeScript source only to the named `.ts` output file.
- Write Markdown review notes only to the named `.md` output file.
- Do not put the full TypeScript source inside review notes.
- Do not put the full TypeScript source in the chat response.
- The chat response should be short, for example:
  `Wrote outputs/common-verification.ts and outputs/common-verification-review.md.`
- If you cannot write a file, say which file failed and why. Do not substitute by
  embedding the source in another file.
