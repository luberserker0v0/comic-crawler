# Capability Pipeline

ComicCrawler requests one stage at a time, validates it, then assembles the
reviewed classes into the final AdapterBase shell.

1. `common-verification`
   - Implement one `CommonCapability` and one `VerificationCapability` subclass.
   - Use `contracts/common-verification-template.ts`.
2. `metadata` — full adapters only
   - Implement one `MetadataCapability` subclass.
   - Extract metadata and the complete chapter catalog in the supplied DOM.
   - Use `contracts/metadata-template.ts`; replace all placeholder selectors.
3. `reader-preparation`
   - Implement one `ReaderPreparationCapability` subclass.
   - Return the reader container and page selectors.
   - Do not implement browser behavior.
4. `chapter-images`
   - Implement one `ChapterImagesCapability` subclass.
   - Extract every comic page URL in the supplied reader DOM.
4. System compose
   - ComicCrawler creates the AdapterBase shell. AO never writes it.

## Boundary

- Verification/readiness and Browser Client content preparation happen before
  extraction.
- Stage code is pure DOM extraction; it does not click, scroll, or navigate.
- Do not mix methods owned by different capabilities.
- If the supplied DOM is incomplete, describe the evidence and risk. Do not
  guess missing chapters or image URLs.
- Do not output JSON.

## Stage files

- `outputs/common-verification.ts`
- `outputs/common-verification-review.md`
- `outputs/metadata-capability.ts`
- `outputs/metadata-review.md`
- `outputs/reader-preparation.ts`
- `outputs/reader-preparation-review.md`
- `outputs/chapter-images-capability.ts`
- `outputs/chapter-images-review.md`
- `outputs/review-notes.md`

Write source and review notes only to the paths requested by the task. Keep the
chat response to a short confirmation.
