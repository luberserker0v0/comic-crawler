# ComicCrawler REST API

This document describes the REST API paths that can drive ComicCrawler without
the WebUI. The default local backend base URL is:

```text
http://127.0.0.1:4100
```

JSON success responses use `{ "data": ... }`. Error responses use
`{ "error": "message" }`. WebSocket events are useful for live updates, but the
flows below must also work by polling REST endpoints.

The machine-readable contract is tracked in `docs/openapi.yaml`. The running
backend serves Swagger UI at:

```http
GET /api-docs
```

Swagger UI loads the same OpenAPI contract internally from its generated spec
routes.

## Interface strategy

ComicCrawler has three user-facing entry points:

- **WebUI** - the complete human workspace for crawl tasks, adapter discovery,
  adapter version review, and Adapter Lab editing/testing.
- **REST API** - the automation contract. API-only clients must be able to drive
  the complete crawl flow without a browser frontend by polling REST endpoints.
- **CLI** - a small local operator surface for simple task/config/development
  commands. Review-heavy adapter work should remain in the WebUI.

The REST API is intentionally broader than the CLI. If a workflow requires
reviewing source code, comparing drafts, inspecting verified DOM, or performing
human verification, prefer the WebUI unless you are building a dedicated API
client.

## Public crawl flow

### 1. Resolve adapter capability

```http
POST /api/adapters/resolve
```

Request:

```json
{
  "url": "https://{comic_site}/manga/{manga_name}/{manga_chapter}",
  "mode": "chapters"
}
```

Replace `{comic_site}`, `{manga_name}`, and `{manga_chapter}` with the real
comic site domain, manga slug/name, and chapter slug/name used by that site.

`mode: "all"` requires both `metadata` and `chapterImages`. `mode: "chapters"`
requires only `chapterImages`.

Possible `data.status` values:

- `matched` - a registered adapter can satisfy the requested mode.
- `capability_mismatch` - the domain matches an adapter, but the adapter lacks
  the requested capability.
- `not_found` - no adapter matches the URL.

### Extract every image URL from one chapter

Use the public chapter-images endpoint when a client needs the adapter's complete
ordered URL result without creating a download task:

```http
POST /api/adapters/chapter-images
```

```json
{
  "url": "https://{comic_site}/manga/{manga_name}/{manga_chapter}",
  "renderContext": {
    "viewport": { "width": 390, "height": 844 },
    "deviceScaleFactor": 3
  }
}
```

The adapter is resolved from the URL. An optional `adapterId` selects a specific
registered adapter, and an optional `challengeDiscoveryId` reuses a completed
human-verification handoff. `renderContext` controls the isolated Playwright
browser context for responsive pages. Viewport dimensions are CSS pixels from
`1` through `10000`; `deviceScaleFactor` is optional and ranges from `0.1`
through `10`. If omitted, the effective context is `1920x1080` at scale `1`.
A successful response returns that effective context and does not truncate the list.
`imageUrlCount` always equals `imageUrls.length`; the example below therefore
contains two URLs and reports a count of `2`:

```json
{
  "data": {
    "adapterId": "site-adapter",
    "chapterUrl": "https://{comic_site}/manga/{manga_name}/{manga_chapter}",
    "imageUrlCount": 2,
    "imageUrls": [
      "https://cdn.example/001.jpg",
      "https://cdn.example/002.jpg"
    ],
    "domSource": "static",
    "durationMs": 42,
    "renderContext": {
      "viewport": { "width": 390, "height": 844 },
      "deviceScaleFactor": 3
    }
  }
}
```

### 2. Create task or queue adapter discovery

```http
POST /api/tasks
```

All-chapter task:

```json
{
  "url": "https://{comic_site}/manga/{manga_name}",
  "mode": "all"
}
```

Specific-chapter task:

```json
{
  "url": "https://{comic_site}/manga/{manga_name}/{manga_chapter}",
  "mode": "chapters",
  "chapterUrls": ["https://{comic_site}/manga/{manga_name}/{manga_chapter}"]
}
```

To run the task on a particular connected computer, select its stable Worker ID:

```json
{
  "browserTarget": {
    "mode": "specific",
    "workerId": "bp_server_assigned_id"
  }
}
```

Use `GET /api/browser-workers` to list the requesting user's Workers. Omit
`browserTarget`, or use `{ "mode": "any" }`, to let the scheduler choose one.
If no matching Worker is idle, the task enters `waiting_for_browser_worker`
until a Worker becomes available or the acquisition timeout expires. Session
IDs are internal lease data and are not accepted by task APIs.
Configure the timeout with `browser.workerWaitTimeoutMs` (default: 1,800,000 ms).

Possible outcomes:

- `201` with `kind: "taskCreated"` - crawl task was queued.
- `202` with `kind: "discoveryQueued"` - selector discovery is required before
  a compatible adapter exists.
- `202` with `kind: "challengeDiscoveryQueued"` - the initial page is blocked
  by a browser challenge and a verification handoff job was created.

### 3. Poll task state

```http
GET /api/tasks
GET /api/tasks/:id
```

Important task statuses:

- `pending`
- `waiting_for_browser_worker`
- `running`
- `waiting_verification`
- `completed`
- `failed`
- `cancelled`
- `interrupted`

`GET /api/tasks/:id` returns the task, progress, result, checkpoint summary, and
preview metadata. `waiting_verification` is resumable and is not a failed state.
It does not occupy a scheduler execution slot, but it keeps its Browser Worker
reserved so another task cannot modify the browser during verification.

### 4. Human verification handoff

The current API namespace is `/api/challenge-discovery`, but the public crawl
flow treats these records as human verification handoff jobs. Every browser
operation uses the configured remote Playwright WebSocket service.

Read the handoff job:

```http
GET /api/challenge-discovery/:id
```

Open the task URL in the configured remote browser service:

```http
POST /api/challenge-discovery/:id/open-browser
```

This creates the browser context through ComicCrawler's remote Playwright
connection. The later inspect, selector-discovery, and verification calls reuse
that context; they do not attach to an unrelated Playwright client session.

After the user completes verification in that browser:

```http
POST /api/challenge-discovery/:id/complete-human-verification
```

Then resume the task:

```http
POST /api/tasks/:id/resume
```

If the handoff is not ready, resume returns `409` with the current handoff job.
If the handoff expired or was removed, resume recreates a handoff job and
returns `409` with the new job so the caller can open the browser again.

Delete or abandon a handoff and release its Browser Worker:

```http
DELETE /api/challenge-discovery/:id
```

### 5. AO adapter discovery and review

When task creation returns `kind: "discoveryQueued"`, poll the discovery job:

```http
GET /api/selector-discovery/:id
```

Stage 1 AO discovery produces a TypeScript `AdapterBase` implementation draft
and Markdown review notes. Review those artifacts before any runtime promotion.
Adapter discovery jobs use the same stable `browserTarget` selection as crawler
tasks. The server creates and closes the short-lived browser session.

After human review, approve the TypeScript implementation draft:

```http
POST /api/selector-discovery/:id/promote
```

Promotion first fetches the reviewed page through the active Browser Provider.
It runs the draft, stores `page.html` and `expected.json`, and only then enables
the adapter. A fixture or extraction failure leaves the discovery job in
`awaiting_review` and does not register the adapter.

Then create the crawl task again.

### 6. Result and previews

```http
GET /api/tasks/:id
GET /api/tasks/:id/preview-file?path=<relative-preview-path>
```

`preview-file` only serves image files under the task output directory.

## Public support APIs

### Browser Provider registration and sessions

Browser-backed operations use a registered user-side Browser Provider. An
SDK client first reads the service document:

```http
GET /.well-known/comiccrawler-browser-provider
```

It contains the contract version, API security mode, `reverse-relay` transport,
registration endpoint, control WebSocket endpoint, and relay endpoint template.

Register one logical Provider instance:

```http
POST /api/browser-providers/enroll
X-ComicCrawler-User-Id: alice
Authorization: Bearer <user-api-token>
Content-Type: application/json

{
  "clientInstanceId": "0ecf4a52-2003-4586-8c90-31fbc426b2a8",
  "providerName": "Alice PC"
}
```

The user headers are omitted in `public` mode. ComicCrawler returns the
server-assigned `providerId`, `credentialId`, and provider credential once. The
CLI stores state and credential in separate files, then uses the Provider
credential for outbound WebSocket connections. Neither the user machine nor
its browser exposes an inbound port.

List the user's Workers before creating a task:

```http
GET /api/browser-workers
```

ComicCrawler reserves one idle Worker when a task starts. It creates the
Playwright session, renews it while the task owns the lease, and closes it when
the task completes. One Worker executes one task at a time in this version.

Use these lifecycle endpoints to inspect Workers or manage credentials:

```http
GET /api/browser-providers
GET /api/browser-workers
POST /api/browser-providers/{providerId}/credentials/rotate
```

The only transport is `reverse-relay`. Protect ComicCrawler's administrative
API, provider credential files, and browser session URLs. Use HTTPS/WSS for
remote deployments.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/.well-known/comiccrawler-browser-provider` | Discover the browser-provider contract and outbound connection endpoints. |
| `GET` | `/api/status` | Health/status check. |
| `GET` | `/api/adapters` | List registered adapters and capabilities. |
| `POST` | `/api/adapters/chapter-images` | Resolve an adapter and return every ordered image URL extracted from one chapter. |
| `GET` | `/api/adapters/deleted` | List deleted adapters, source deletion status, and restore availability. |
| `GET` | `/api/adapters/:id` | Read adapter detail. |
| `GET` | `/api/adapters/:id/capabilities` | Read Adapter Lab capabilities and fine-grained function descriptors. |
| `GET` | `/api/adapters/:id/implementation` | Read full Adapter Lab implementation source/manifest. |
| `POST` | `/api/adapters/:id/functions/:functionId/test` | Run an Adapter Lab function test against the supplied URL. |
| `POST` | `/api/adapters/:id/drafts` | Create a user-owned editable draft copy. |
| `POST` | `/api/adapters/:id/restore` | Restore a deleted adapter when a runtime backup or restored project source is available. |
| `DELETE` | `/api/adapters/:id` | Delete a registered adapter. Generated runtime records are backed up in the deleted marker; project TypeScript adapter source directories under `backend/src/adapter/sites/` are deleted as a code change. |
| `GET` | `/api/adapter-drafts` | List user-owned adapter drafts. |
| `GET` | `/api/adapter-drafts/:id` | Read a saved adapter draft. |
| `PUT` | `/api/adapter-drafts/:id/content` | Save draft content without executing it. |
| `POST` | `/api/adapter-drafts/:id/reset` | Reset draft content from the active adapter. |
| `POST` | `/api/adapter-drafts/:id/functions/:functionId/test` | Test a dynamic manifest, generated TypeScript, or project-source TypeScript draft with a temporary adapter. |
| `DELETE` | `/api/adapter-drafts/:id` | Discard a draft. |
| `GET` | `/api/tasks/priority-order` | Read forced task order. |
| `PUT` | `/api/tasks/priority-order` | Replace forced task order. |
| `POST` | `/api/tasks/:id/pause` | Pause a running task when supported. |
| `POST` | `/api/tasks/:id/cancel` | Cancel a task. |
| `DELETE` | `/api/tasks/:id` | Delete terminal or waiting-verification tasks. |
| `GET` | `/api/config` | Read global config. |
| `PUT` | `/api/config` | Update global config. |
| `POST` | `/api/config/download-directory/open` | Open the configured download directory. |
| `GET` | `/api/config/selector-discovery` | Read selector discovery settings without provider secrets. |
| `PUT` | `/api/config/selector-discovery` | Save AO URL, provider document, and selected model. |
| `POST` | `/api/config/selector-discovery/test` | Test selector discovery settings. |
| `POST` | `/api/browser-providers/enroll` | Register a Provider instance and return its credential once. |
| `GET` | `/api/browser-providers` | List visible registered Provider identities and online state. |
| `GET` | `/api/browser-workers` | List stable Worker targets and their `offline`, `idle`, or `busy` state. |
| `DELETE` | `/api/browser-providers/:providerId` | Revoke one Provider credential and close its resources. |
| `POST` | `/api/browser-providers/:providerId/credentials/rotate` | Rotate one Provider credential and return the replacement once. |

Adapter Lab function tests are diagnostic support APIs. The WebUI locks
metadata tests to manga catalog URLs and chapter image tests to chapter URLs;
API callers should follow the same input contract. `extractChapterImageUrls`
returns the full `imageUrls` list plus `imageUrlCount`; it does not return a
shortened `firstImageUrls` preview. Test responses may include timing breakdown
entries such as `dom_acquisition`, `extraction`, and `readiness`.
Browser-backed test and chapter-image requests may use the same
`browserTarget` object as crawl tasks. The Server owns and releases their
short-lived browser lease when the request finishes.

Verified fixture routes also exist for diagnostics:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/dom-readiness/check` | Check whether supplied HTML looks like trusted comic DOM. |
| `POST` | `/api/fixtures/capture` | Capture verified DOM from a ready handoff browser session. |
| `GET` | `/api/fixtures/:domain/:id` | Read captured fixture metadata, optionally with HTML. |
| `POST` | `/api/fixtures/:domain/:id/test-adapter-function` | Test an adapter function against a captured fixture. |
| `POST` | `/api/fixtures/:domain/:id/verify-approved-adapter` | Replay all approved functions and compare them with `expected.json`. |

Approved-fixture verification accepts this request body:

```json
{
  "adapterId": "comix"
}
```

The response includes `passed`, `expected`, and `actual`. A mismatch returns a
normal `200` response with `passed: false`, so test runners can show the diff.

## Internal or diagnostic endpoints

These routes currently exist but should not be used as the normal crawl API:

- `POST /api/adapters/register` - placeholder/test-oriented endpoint.
- `POST /api/challenge-discovery`
- `GET /api/challenge-discovery`
- `DELETE /api/challenge-discovery/:id`
- `POST /api/challenge-discovery/:id/retry`
- `POST /api/challenge-discovery/:id/promote`
- `POST /api/challenge-discovery/:id/inspect-remote-page`
- `POST /api/challenge-discovery/:id/create-selector-discovery-from-remote`
- `/api/agent/adapters/*` - adapter review/admin routes.

They may remain useful for tests, development, diagnostics, or future AO work,
but they are intentionally excluded from the public crawl flow above.

## WebSocket

`/ws` emits task and image events for live UI updates. API-only clients can use
the REST task resources directly.

## CLI boundary

The CLI should stay focused on simple, scriptable operations:

- inspect task status;
- run a direct download through an already registered adapter;
- read or update local config;
- run selector-discovery bundle evaluation and development commands.

The CLI should not try to duplicate Adapter Lab or adapter review UX. In
particular, source editing, draft diff/review, promotion, rollback, and
interactive human verification remain WebUI-first workflows.
