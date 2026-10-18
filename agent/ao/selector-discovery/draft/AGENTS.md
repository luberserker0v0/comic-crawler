# ComicCrawler Selector Discovery

This is a temporary AO workspace. ComicCrawler remains the source of truth.

- Read `contracts/adapter-base-api.md` and `contracts/capability-pipeline.md`.
- Task-facing analysis and review notes use Markdown, never JSON.
- Write only the requested capability subclass and output files.
- ComicCrawler assembles the final `AdapterBase` shell.
- Treat supplied DOM as Playwright-rendered evidence; do not fetch or control a
  browser from capability code.
- Report incomplete evidence instead of inventing data.
- Prefer stable, Cheerio-compatible selectors.
