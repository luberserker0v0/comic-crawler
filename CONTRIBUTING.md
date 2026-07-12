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

- Public REST API contracts or API-only crawl flow:

  ```bash
  npm run test:api
  ```

- WebUI flows, crawler behavior, challenge handoff, selector discovery, dynamic
  adapters, or reliability behavior:

  ```bash
  npm run verify:local
  ```

`verify:quick` includes the real `npm run dev` smoke test, build, UTF-8 and
common mojibake verification, core backend reliability tests, and the REST-only
API crawl flow test. Fake dev tests must not be used as a substitute for the
real dev smoke test.

GitHub Actions runs `npm run verify:quick` on every push and pull request. The
full Playwright E2E workflow is available as a manual GitHub Actions run until
it is promoted to a required PR gate.

## Encoding and formatting

- Store text files as UTF-8 with LF endings and final newline.
- `npm run verify:utf8` checks byte-level UTF-8 validity and common mojibake
  patterns; it is not only a decoder check.
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

Adapters extend `AdapterBase`, declare `parseMode`, and expose accurate
capabilities:

- `metadata` for manga metadata and chapter lists.
- `chapterImages` for image extraction from chapter URLs.
- `verification` when the adapter participates in human verification handoff.

Do not fake unsupported capabilities. A chapter-only adapter is valid, but it
must not claim metadata support until metadata extraction has been implemented
and verified.

Site strategy must be visible in the adapter implementation or reviewed dynamic
manifest. Runtime and Adapter Lab should not hide site-specific behavior behind
generic pre-extraction button clicking or DOM preparation.

Built-in adapters should include focused unit tests. Verified DOM fixtures may
be captured from real browser sessions for local diagnosis, but hand-written
fake site fixtures must not be used to imply live-site correctness. Dynamic
adapters should come from reviewed selector drafts and should be promoted
through the existing adapter review flow.

## AO, selector discovery, and verification handoff

AO-facing selector bundle work lives under `agent/ao/`. Agent-facing contracts
use Markdown sections, not JSON schemas. Provider documents and `opencode.json`
are system settings and must not be copied into task-facing Markdown logs.

Selector discovery candidates must be reviewed before promotion. The current
public verification flow uses human handoff jobs under the historical
`/api/challenge-discovery/*` namespace; challenge strategy discovery utilities
are internal/experimental unless explicitly promoted later. Provider secrets,
token paths, and API keys must not be logged or returned from read APIs.

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
