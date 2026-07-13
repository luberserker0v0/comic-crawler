# ComicCrawler repo documents

This directory contains user- and contributor-facing documentation for the
`repo/` source tree.

## Current documents

- `USER_GUIDE.md` - WebUI flow for all-chapter tasks, chapter-only tasks,
  waiting verification, resume, previews, and download folder operations.
- `API.md` - concise reference for the currently implemented backend routes.
- `openapi.yaml` - machine-readable contract for the public REST crawl flow;
  the running backend serves Swagger UI at `GET /api-docs`.
- `ARCHITECTURE.md` - current subsystem overview and runtime data flow.
- `ADAPTERS.md` - adapter contract, capabilities, Adapter Lab, drafts, and
  verified fixture policy.
- `AO_SELECTOR_DISCOVERY.md` - AO adapter implementation discovery stages,
  `AdapterBase` output contract, and AO API lifecycle.

## Documentation boundary

- External software development documents such as SRS, SDD, STD, TDD, roadmap,
  and implementation notes belong in the outer `../docs/` directory.
- Contributor workflow belongs in `../CONTRIBUTING.md`, not here.
- Agent-facing instructions belong in the outer `../AGENTS.md`.

## Missing docs to add

- `RELIABILITY.md` - checkpoints, queue slot release, retry behavior, resume,
  and forced task order.
