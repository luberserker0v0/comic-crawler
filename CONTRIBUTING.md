# Contributing to ComicCrawler

This guide is for contributors working in `repo/`, which is the source-of-truth
Git root for ComicCrawler.

## Development setup

Requirements:

- Node.js 20.19 or newer
- npm 9 or newer
- Git

Install dependencies and start the local development environment:

```bash
npm install
npm run dev
```

If Windows PowerShell displays broken Chinese text, use:

```bash
npm run dev:utf8
```

## Repository layout

```text
frontend/   React + Vite WebUI
backend/    Fastify API, crawler engine, task queue, adapters
shared/     shared TypeScript types and defaults
agent/ao/   AO bundle drafts, agents, skills, contracts, eval cases
docs/       user/contributor-facing docs
```

Runtime state such as `data/`, `backend/data/`, downloads, build output, test
results, and Playwright reports must not be committed.

## Verification gates

Use the smallest gate that covers your change:

- Dev launcher, ports, Vite proxy, process startup:

  ```bash
  npm run test:dev
  ```

- Backend/frontend/shared changes:

  ```bash
  npm run verify:quick
  ```

- WebUI flows, crawler behavior, challenge handoff, selector discovery, dynamic
  adapters, or reliability behavior:

  ```bash
  npm run verify:local
  ```

`verify:quick` includes the real `npm run dev` smoke test, build, UTF-8
verification, and core backend reliability tests. Fake dev tests must not be
used as a substitute for the real dev smoke test.

## Encoding and formatting

- Store text files as UTF-8 with LF endings and final newline.
- `.editorconfig` defines editor behavior; it cannot repair already corrupted
  text.
- After changing Chinese text or docs, run:

  ```bash
  npm run verify:utf8
  ```

## Commit style

Use Conventional Commits:

```text
<type>(<scope>): <description>
```

Common types:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`

Common scopes:

- `frontend`
- `backend`
- `shared`
- `adapter`
- `crawler`
- `task`
- `challenge`
- `selector-discovery`
- `docs`

Example:

```text
fix(task): resume waiting verification tasks from checkpoint
```

## Adapter contributions

Adapters should expose accurate capabilities:

- `metadata` for manga metadata and chapter lists.
- `chapterImages` for image extraction from chapter URLs.
- `verification` when the adapter participates in human verification handoff.

Do not fake unsupported capabilities. A chapter-only adapter is valid, but it
must not claim metadata support until metadata extraction has been implemented
and verified.

Built-in adapters should include unit fixtures. Dynamic adapters should come
from reviewed selector candidates and should be promoted through the existing
agent adapter review flow.

## AO and dynamic adapter workflow

AO-facing selector and challenge bundles live under `agent/ao/`. Agent-facing
contracts use Markdown sections, not JSON schemas. Provider documents and
`opencode.json` are system settings and must not be copied into task-facing
Markdown logs.

Selector discovery and challenge discovery candidates must be reviewed before
promotion. Provider secrets, token paths, and API keys must not be logged or
returned from read APIs.

## Pull request checklist

Before opening a PR or handing off local changes:

- [ ] No runtime/generated files are staged.
- [ ] `git add -n -A` does not include `data/`, `dist/`, `test-results/`,
      `playwright-report/`, `backend/tests/**/__tmp__/`, or generated shared
      `.js/.d.ts` files.
- [ ] Relevant verification gate passed.
- [ ] `npm run verify:utf8` passed after doc/text changes.
- [ ] README/docs were updated if behavior or public interfaces changed.
- [ ] No provider secrets, tokens, cookies, browser profiles, or downloaded
      comic images are committed.
