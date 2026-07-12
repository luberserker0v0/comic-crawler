# ComicCrawler REST API

This document describes the REST API paths that can drive ComicCrawler without
the WebUI. The default local backend base URL is:

```text
http://127.0.0.1:4100
```

JSON success responses use `{ "data": ... }`. Error responses use
`{ "error": "message" }`. WebSocket events are useful for live updates, but the
flows below must also work by polling REST endpoints.

The machine-readable contract is tracked in `docs/openapi.yaml`.

## Public crawl flow

### 1. Resolve adapter capability

```http
POST /api/adapters/resolve
```

Request:

```json
{
  "url": "https://example.test/manga/demo/chapter-1",
  "mode": "chapters"
}
```

`mode: "all"` requires both `metadata` and `chapterImages`. `mode: "chapters"`
requires only `chapterImages`.

Possible `data.status` values:

- `matched` - a registered adapter can satisfy the requested mode.
- `capability_mismatch` - the domain matches an adapter, but the adapter lacks
  the requested capability.
- `not_found` - no adapter matches the URL.

### 2. Create task or queue adapter discovery

```http
POST /api/tasks
```

All-chapter task:

```json
{
  "url": "https://example.test/manga/demo",
  "mode": "all"
}
```

Specific-chapter task:

```json
{
  "url": "https://example.test/manga/demo/chapter-1",
  "mode": "chapters",
  "chapterUrls": ["https://example.test/manga/demo/chapter-1"]
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
flow treats these records as human verification handoff jobs. Strategy discovery
and CDP inspection endpoints are diagnostic/internal and are not part of the
normal crawl flow.

Read the handoff job:

```http
GET /api/challenge-discovery/:id
```

Open the isolated browser for the user:

```http
POST /api/challenge-discovery/:id/open-external-browser
```

Optional body:

```json
{
  "executablePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "profileId": "default"
}
```

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

### 5. Selector discovery and adapter promotion

When task creation returns `kind: "discoveryQueued"`, poll the discovery job:

```http
GET /api/selector-discovery/:id
```

Validate/revalidate if needed:

```http
POST /api/selector-discovery/:id/validate
POST /api/selector-discovery/:id/revalidate
```

After human review, approve the draft:

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

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/status` | Health/status check. |
| `GET` | `/api/adapters` | List registered adapters and capabilities. |
| `GET` | `/api/adapters/:id` | Read adapter detail. |
| `GET` | `/api/adapters/:id/implementation` | Read full Adapter Lab implementation source/manifest. |
| `POST` | `/api/adapters/:id/drafts` | Create a user-owned editable draft copy. |
| `GET` | `/api/adapter-drafts` | List user-owned adapter drafts. |
| `GET` | `/api/adapter-drafts/:id` | Read a saved adapter draft. |
| `PUT` | `/api/adapter-drafts/:id/content` | Save draft content without executing it. |
| `POST` | `/api/adapter-drafts/:id/reset` | Reset draft content from the active adapter. |
| `POST` | `/api/adapter-drafts/:id/functions/:functionId/test` | Test a dynamic manifest draft with a temporary adapter. Built-in TS drafts are not executed. |
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

## Internal or diagnostic endpoints

These routes currently exist but should not be used as the normal crawl API:

- `POST /api/adapters/register` - placeholder/test-oriented endpoint.
- `POST /api/challenge-discovery`
- `GET /api/challenge-discovery`
- `POST /api/challenge-discovery/:id/retry`
- `POST /api/challenge-discovery/:id/promote`
- `POST /api/challenge-discovery/:id/open-browser`
- `POST /api/challenge-discovery/cdp/test`
- `POST /api/challenge-discovery/:id/inspect-cdp-page`
- `POST /api/challenge-discovery/:id/create-selector-discovery-from-cdp`
- `/api/site-discovery/*` - backwards-compatible alias for selector discovery.
- `/api/agent/adapters/*` - adapter review/admin routes.

They may remain useful for tests, development, diagnostics, or future AO work,
but they are intentionally excluded from the public crawl flow above.

## WebSocket

`/ws` emits task and image events for live UI updates. REST polling remains the
contractual fallback for API-only clients.
