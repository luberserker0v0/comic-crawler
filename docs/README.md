# ComicCrawler repo documents

This directory contains user- and contributor-facing documentation for the
`repo/` source tree.

## Current documents

- `USER_GUIDE.md` - WebUI flow for all-chapter tasks, chapter-only tasks,
  waiting verification, resume, previews, and download folder operations.
- `API.md` - concise reference for the currently implemented backend routes.
- `openapi.yaml` - machine-readable contract for the public REST crawl flow.
- `ARCHITECTURE.md` - current subsystem overview and runtime data flow.

## Documentation boundary

- External software development documents such as SRS, SDD, STD, TDD, roadmap,
  and implementation notes belong in the outer `../docs/` directory.
- Contributor workflow belongs in `../CONTRIBUTING.md`, not here.
- Agent-facing instructions belong in the outer `../AGENTS.md`.

## Missing docs to add

- `ADAPTERS.md` - built-in vs dynamic adapters, capabilities, promote/rollback,
  and chapter-only behavior.
- `AO_SELECTOR_DISCOVERY.md` - AO URL, provider JSON, model selection, bundle
  eval, and Markdown draft review workflow.
- `RELIABILITY.md` - checkpoints, queue slot release, retry behavior, resume,
  and forced task order.
