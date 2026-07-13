# AO Adapter Implementation Discovery

ComicCrawler uses AO to help create adapter implementation drafts for unknown or
capability-incomplete comic sites.

## Two-stage rollout

### Stage 1: document and API-flow calibration

Stage 1 does not promote AO output into runtime adapters.

Goals:

- verify that AO-facing Markdown files describe the correct `AdapterBase`
  implementation contract;
- verify that ComicCrawler calls the AO conversation/message API correctly;
- save AO output artifacts for review;
- statically validate the TypeScript implementation draft.

Expected AO artifacts:

- `outputs/adapter-implementation.ts`
- `outputs/review-notes.md`

### Stage 2: live AO output analysis

Stage 2 uses a real AO instance and evaluates output quality.

The team reviews:

- whether the adapter extends `AdapterBase`;
- whether `id`, `name`, `domains`, `parseMode`, and `capabilities` are correct;
- whether fine-grained functions return correct data;
- whether chapter lists are complete;
- whether image extraction excludes cover/logo/UI/ad images;
- whether human verification requirements are represented correctly;
- whether poor output was caused by weak DOM summaries, unclear contracts,
  missing verified fixtures, or insufficient validation.

If output quality is poor, update AO-facing documents first, then rerun the same
case and compare artifacts.

## AO-facing contract

AO receives Markdown task files and sanitized DOM summaries. AO must not read or
write JSON contracts.

Final output is a TypeScript adapter implementation draft, not a selector
manifest:

```text
outputs/adapter-implementation.ts
outputs/review-notes.md
```

The TypeScript file must export one class that extends `AdapterBase`. It must
declare:

- `id`
- `name`
- `domains`
- `parseMode`
- `capabilities`

It should implement supported capability handlers using ComicCrawler's adapter
base classes:

- `CommonCapability`
- `VerificationCapability`
- `MetadataCapability`
- `ChapterImagesCapability`

AO must implement fine-grained extraction functions. It must not implement
`fetchMetadata()` or `fetchChapterImages()`; ComicCrawler runtime composes those
facades internally.

## Backend AO API lifecycle

For each AO phase, ComicCrawler:

1. creates a short-lived AO conversation;
2. uploads `opencode.json`, `AGENTS.md`, primary/subagent files, skills, and
   Markdown contracts;
3. uploads `task.md`;
4. starts the conversation;
5. polls AO conversation status until ready;
6. sends a message with:
   - `agent: "selector-discovery"`
   - caller-selected `model`
   - Markdown task text
7. reads requested output files;
8. deletes the conversation.

The message timeout is 15 minutes. Provider credentials stay in system config and
must not be written into task logs or AO-facing Markdown.

## Current Stage 1 behavior

ComicCrawler saves AO implementation artifacts on the discovery job:

- `adapterImplementationTs`
- `reviewNotesMarkdown`
- `implementationValidation`

It also stores an artifact under runtime storage using the discovery job id.

Stage 1 does not load or promote AO TypeScript into the runtime registry. Runtime
promotion of TypeScript adapters is a Stage 2 follow-up after validation,
sandboxing, and review policy are finalized.
