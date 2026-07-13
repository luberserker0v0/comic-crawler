# Adapter Capability Pipeline

Use this contract whenever ComicCrawler asks you to produce adapter TypeScript.

Do not write a whole adapter as one unstructured block first. Produce and reason
about adapter behavior in capability stages. ComicCrawler may ask for one stage
at a time, then ask for a composed adapter after review.

## Stage Order

1. `common-verification`
   - Implement the adapter shell identity.
   - Implement `CommonCapability.matchUrl`.
   - Implement `VerificationCapability.detectVerificationRequired`.
   - Implement `VerificationCapability.describeVerificationHandoff`.
   - This stage is required for every adapter, even when no verification is
     observed. In that case detection returns `false` for normal pages and true
     for generic blocked/challenge signals.
2. `metadata`
   - Required for full adapters.
   - Implement only `MetadataCapability`.
   - Extract title, author, description, cover URL, tags, status, and the full
     chapter list from trusted metadata DOM.
3. `chapter-images`
   - Required for every chapter-capable adapter.
   - Implement only `ChapterImagesCapability`.
   - Extract all comic page image URLs from trusted reader DOM.
4. `compose`
   - Assemble reviewed capability handlers into one `AdapterBase` site adapter.

## Boundaries

- `VerificationCapability` is the DOM trust gate. Later stages must assume the
  supplied DOM has already passed verification/readiness checks.
- Capability handlers are mutually scoped. Metadata code must not implement
  image extraction. Chapter image code must not implement metadata extraction.
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
- `outputs/adapter-implementation.ts`
- `outputs/review-notes.md`

If the task message names a narrower set of output files, write only those files.
