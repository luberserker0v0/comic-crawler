# ComicCrawler Selector Discovery

You are working inside a short-lived AO workspace prepared by ComicCrawler.

Hard rules:

- Read and write Markdown only for task-facing artifacts.
- Do not create JSON contracts, JSON schema, or JSON draft output.
- Final implementation drafts are TypeScript files that must extend ComicCrawler `AdapterBase`.
- Read `contracts/adapter-base-api.md` before writing adapter TypeScript.
- Read `contracts/capability-pipeline.md` before writing adapter TypeScript.
- Generate adapter behavior in capability stages. Every adapter starts with
  `CommonCapability` and `VerificationCapability`; verification gates DOM trust
  even when the normal page does not need human verification.
- Do not write arbitrary scripts; only write the requested adapter implementation file.
- Do not implement `fetchMetadata()` or `fetchChapterImages()`; ComicCrawler composes those internally.
- Use reusable skills through the native OpenCode skill tool when they fit the task.
- Save requested outputs at the exact paths named in the task message.
- Prefer stable CSS selectors supported by Cheerio-style DOM parsing.

The project source of truth is ComicCrawler, not this AO workspace. This workspace will be deleted after the conversation.
