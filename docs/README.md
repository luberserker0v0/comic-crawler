# ComicCrawler repo documents

This directory contains user- and contributor-facing documentation for the
`repo/` source tree.

## Current documents

- `USER_GUIDE.md` - WebUI flow for all-chapter tasks, chapter-only tasks,
  Browser Provider setup, verification, resume, and downloads.
- `DEVELOPER_GUIDE.md` - local setup, runtime settings, troubleshooting, test
  gates, and Browser Provider development.
- `API.md` - concise reference for the currently implemented backend routes.
- `openapi.yaml` - machine-readable contract for the public REST crawl flow;
  the running backend serves Swagger UI at `GET /api-docs`.
- `ARCHITECTURE.md` - system context, startup responsibilities, components,
  Browser Provider boundary, and runtime data flow.
- `ADAPTERS.md` - adapter contract, capabilities, deletion behavior, Adapter
  Lab, drafts, and verified fixture policy.
- `AO_SELECTOR_DISCOVERY.md` - AO adapter implementation discovery stages,
  `AdapterBase` output contract, and AO API lifecycle.
- `RELIABILITY.md` - checkpoints, queue slot release, retry behavior, resume,
  forced task order, and adapter lifecycle recovery.

## Documentation boundary

- External software development documents such as SRS, SDD, STD, TDD, roadmap,
  and implementation notes belong in the outer `../../docs/` directory.
- Contributor workflow belongs in `../CONTRIBUTING.md`, not here.
- Agent-facing instructions belong in the outer `../../AGENTS.md`.
