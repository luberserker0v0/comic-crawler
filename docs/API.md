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
  "url": "https://{comic_site}/manga/{manga_name}/{manga_chapter}"
}
```

The adapter is resolved from the URL. An optional `adapterId` selects a specific
registered adapter, and an optional `challengeDiscoveryId` reuses a completed
human-verification handoff. A successful response does not truncate the list.
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
    "durationMs": 42
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
- `running`
- `waiting_verification`
- `completed`
- `failed`
- `cancelled`
- `interrupted`

`GET /api/tasks/:id` returns the task, progress, result, checkpoint summary, and
preview metadata. `waiting_verification` is resumable and is not a failed state.
While a task is waiting for verification, it does not occupy a worker slot.

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

### 5. AO adapter discovery and review

When task creation returns `kind: "discoveryQueued"`, poll the discovery job:

```http
GET /api/selector-discovery/:id
```

Stage 1 AO discovery produces a TypeScript `AdapterBase` implementation draft
and Markdown review notes. Review those artifacts before any runtime promotion.

After human review, approve the TypeScript implementation draft:

```http
POST /api/selector-discovery/:id/promote
```

Then create the crawl task again.

### 6. Result and previews

```http
GET /api/tasks/:id
GET /api/tasks/:id/preview-file?path=<relative-preview-path>
```

`preview-file` only serves image files under the task output directory.

## Public support APIs

### Browser Provider registration and sessions

Browser-backed operations use an enrolled user-side Browser Provider. An
SDK client first reads the service document:

```http
GET /.well-known/comiccrawler-browser-provider
```

It contains the contract version, `reverse-relay` transport, enrollment
endpoint, control WebSocket endpoint, and relay endpoint template. An
administrator then creates a short-lived, one-time enrollment token:

```http
POST /api/browser-providers/enrollment-tokens
Content-Type: application/json

{ "ttlSeconds": 600 }
```

The user-side CLI submits that token to `POST /api/browser-providers/enroll` as
`Authorization: Bearer <token>`. ComicCrawler returns the server-assigned
`providerId`, `credentialId`, and credential once. The CLI stores state and the
credential in separate files, then uses the credential for an outbound
WebSocket connection to `/api/browser-providers/connect`. Neither the user
machine nor its browser exposes an inbound port.

Create the active browser session:

```http
POST /api/browser-providers/{providerId}/sessions
Content-Type: application/json

{
  "requestedCapabilities": {
    "interactive": true
  },
  "ttlSeconds": 1800
}
```

ComicCrawler automatically resolves the active session's relay `connectUrl` for
all browser-backed work. Only one active session is supported by the current
registry. Enrollment records persist across backend restarts; the client
reconnects outbound and sessions remain short-lived.

Use these lifecycle endpoints to inspect, renew, or close it:

```http
GET /api/browser-providers
GET /api/browser-providers/sessions/active
POST /api/browser-providers/sessions/{sessionId}/heartbeat
DELETE /api/browser-providers/sessions/{sessionId}
```

The only transport is `reverse-relay`. Protect ComicCrawler's administrative
API, provider credential files, and active session URLs. Use HTTPS/WSS for
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
| `POST` | `/api/adapter-drafts/:id/functions/:functionId/test` | Test a dynamic manifest draft with a temporary adapter. Project-source TS drafts are not executed. |
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
| `POST` | `/api/browser-providers/enrollment-tokens` | Create a short-lived one-time enrollment token. |
| `POST` | `/api/browser-providers/enroll` | Exchange an enrollment token for server-assigned provider state and a credential. |
| `GET` | `/api/browser-providers` | List registered providers and the active session. |
| `DELETE` | `/api/browser-providers/:providerId` | Revoke and remove an enrolled provider that has no active session. |
| `GET` | `/api/browser-providers/sessions/active` | Read the active browser session. |
| `POST` | `/api/browser-providers/:providerId/sessions` | Create and activate a negotiated browser session. |
| `POST` | `/api/browser-providers/sessions/:sessionId/heartbeat` | Extend the active session expiry. |
| `DELETE` | `/api/browser-providers/sessions/:sessionId` | Close the active session and its user-side browser. |

Adapter Lab function tests are diagnostic support APIs. The WebUI locks
metadata tests to manga catalog URLs and chapter image tests to chapter URLs;
API callers should follow the same input contract. `extractChapterImageUrls`
returns the full `imageUrls` list plus `imageUrlCount`; it does not return a
shortened `firstImageUrls` preview. Test responses may include timing breakdown
entries such as `dom_acquisition`, `extraction`, and `readiness`.

Verified fixture routes also exist for diagnostics:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/dom-readiness/check` | Check whether supplied HTML looks like trusted comic DOM. |
| `POST` | `/api/fixtures/capture` | Capture verified DOM from a ready handoff browser session. |
| `GET` | `/api/fixtures/:domain/:id` | Read captured fixture metadata, optionally with HTML. |
| `POST` | `/api/fixtures/:domain/:id/test-adapter-function` | Test an adapter function against a captured fixture. |

## Internal or diagnostic endpoints

These routes currently exist but should not be used as the normal crawl API:

- `POST /api/adapters/register` - placeholder/test-oriented endpoint.
- `POST /api/challenge-discovery`
- `GET /api/challenge-discovery`
- `POST /api/challenge-discovery/:id/retry`
- `POST /api/challenge-discovery/:id/promote`
- `POST /api/challenge-discovery/remote/test`
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
