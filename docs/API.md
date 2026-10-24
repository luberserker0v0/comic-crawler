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

## Signed adapter registry

The Server can pull adapter packages from administrator-trusted registries:

- `GET /api/adapter-registry/packages` verifies and lists remote packages.
- `GET /api/adapter-registry/updates?adapterId={id}` lists missing newest versions.
- `POST /api/adapter-registry/install` installs one verified version.
- `POST /api/adapter-registry/update` installs available verified updates.

Install and update default to `activate: false`. The signed index and package,
local package validation, and Catalog immutability are all checked before a
write. See [Official Adapter Registry](ADAPTER_REGISTRY.md).

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
requires only `chapterImages`. `mode: "inspect"` matches the URL without
requiring a crawl capability and is intended for Adapter Lab.

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
human-verification handoff. For browser-backed extraction, `browserTarget` uses
the same payload as crawl tasks. Pass `workerId + resourceId` to adopt an
existing tab. Pass a managed-profile Worker, or omit the target, to let the
scheduler select one.

`renderContext` controls an isolated page only when the selected Worker supports
responsive viewport creation. An existing tab keeps its current viewport.
Viewport dimensions are CSS pixels from `1` through `10000`;
`deviceScaleFactor` is optional and ranges from `0.1` through `10`. If omitted,
the effective context is `1920x1080` at scale `1`.
A successful response returns that effective context and does not truncate the list.
It also returns opaque chapter and page identities. `imageUrlCount` always equals
both `imageUrls.length` and `images.length`. `images.map(image => image.url)` is
identical to `imageUrls`, including order. The example below therefore contains
two URLs and reports a count of `2`:

```json
{
  "data": {
    "adapterId": "site-adapter",
    "chapterUrl": "https://{comic_site}/manga/{manga_name}/{manga_chapter}",
    "chapter": {
      "id": "chapter_nL7pRZ7Yf0tY02mI1y9lNrPq",
      "canonicalUrl": "https://{comic_site}/manga/{manga_name}/{manga_chapter}",
      "stability": "deterministic",
      "identitySource": "normalized-url"
    },
    "imageUrlCount": 2,
    "imageUrls": [
      "https://cdn.example/001.jpg",
      "https://cdn.example/002.jpg"
    ],
    "images": [
      {
        "id": "page_XPtJJLh5Qm8kQ9V4yO0fYm2n",
        "orderIndex": 0,
        "url": "https://cdn.example/001.jpg"
      },
      {
        "id": "page_qAsSNF3rNz7L1H9sK5b0mV2x",
        "orderIndex": 1,
        "url": "https://cdn.example/002.jpg",
        "sourceFingerprint": "sha256:optional-adapter-revision"
      }
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

When verification is required, the endpoint returns `409`. The response has the
stable code `CHAPTER_IMAGES_VERIFICATION_REQUIRED`. Its `data.challenge` object
contains the handoff ID, current status, retry flag, and retained browser target:

```json
{
  "error": "Human verification is required.",
  "code": "CHAPTER_IMAGES_VERIFICATION_REQUIRED",
  "data": {
    "status": "verification_required",
    "challengeDiscoveryId": "challenge-discovery-01",
    "challengeStatus": "queued",
    "challenge": {
      "id": "challenge-discovery-01",
      "status": "queued",
      "normalizedUrl": "https://comic.example/manga/example/chapter-10",
      "retryableAfterVerification": true,
      "ownerUserId": "user-01",
      "browserTarget": {
        "mode": "existing-tab",
        "workerId": "worker-01",
        "resourceId": "tab-01"
      }
    }
  }
}
```

The handoff keeps the authenticated owner, normalized URL, and exact
`browserTarget`. Poll its ID until it reaches `challenge_required`, complete
verification, then submit the chapter-images request again with the same
`challengeDiscoveryId`. Do not create a second handoff for the retry.

Identity guarantees:

1. `chapter.id` is scoped to `adapterId`.
2. Page `id` is scoped to `chapter.id`.
3. IDs are deterministic across Server restarts.
4. IDs are opaque and must not be parsed.
5. IDs never contain filesystem paths, Browser Client handles, or tab IDs.
6. Reordering changes `orderIndex`, not the ID of an unchanged source page.
7. Inserting or removing a distinct page does not change unaffected page IDs.

An adapter may provide site-native identity rules. Such responses report
`chapter.identitySource` as `adapter`. Otherwise ComicCrawler reports
`normalized-url` and derives page identity from the URL path plus non-volatile
query parameters. The fallback ignores the CDN origin, fragment, and common
signature parameters such as `token`, `signature`, `expires`, `x-amz-*`, and
`x-goog-*`. Host rotation and signed URL renewal therefore do not change an ID
when the remaining source key is unchanged.

For source replacement, a changed source key receives a new page ID. An adapter
may instead retain its stable source key and return `sourceFingerprint`; the page
ID then remains stable while the fingerprint changes. Fingerprints are optional
and use a semantic prefix such as `sha256:`, `etag:`, or `opaque:`. ComicCrawler
does not download an image solely to calculate a fingerprint. A same-key content
replacement cannot be detected when the adapter supplies no fingerprint.

Consumers should persist `chapter.id` and `images[].id`, use `orderIndex` only
for current presentation order, and use `url` only for retrieval. Changes to an
adapter identity algorithm are data migrations and must not be made casually.

`chapterUrl`, `imageUrlCount`, and `imageUrls` remain available throughout the
0.x API line. Their removal requires a documented deprecation and a future major
API version. Existing callers may ignore `chapter` and `images`.

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

To run the task in a new managed profile, omit `browserTarget` or select an
optional managed-profile Worker:

```json
{
  "browserTarget": {
    "mode": "managed-profile",
    "workerId": "bw_server_assigned_id"
  }
}
```

An existing-tab Browser Client registers its current tab through the SDK, then binds the
task to that exact process-memory resource:

```json
{
  "browserTarget": {
    "mode": "existing-tab",
    "workerId": "bw_server_assigned_id",
    "resourceId": "brr_sdk_generated_id"
  }
}
```

Choose a target in this order:

1. Call `GET /api/browser-workers`.
2. Keep Workers that are online and idle.
3. Read each Worker's `capabilities.executionMode`.
4. For existing-tab, call `GET /api/browser-resources`.
5. Select a resource owned by that Worker with the exact target URL.
6. Send its `workerId + resourceId` in `browserTarget`.

For managed-profile, send a Worker ID or omit it. Omitting `browserTarget`, or
using `{ "mode": "managed-profile" }`, lets the scheduler choose an available
managed-profile Worker. The WebUI uses these same APIs. It cannot inspect or
register local tabs by itself.

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

`GET /api/tasks/:id` returns the task, progress, result, checkpoint summary,
preview metadata, and persisted recovery events. `waiting_verification` is
resumable and is not a failed state.
It does not occupy a scheduler execution slot, but it keeps its Browser Worker
reserved so another task cannot modify the browser during verification.

### 4. Recover an existing-tab task after Client restart

1. Reconnect the Browser Client.
2. Ask the user to approve the tab again.
3. Register the tab as a new resource.
4. Read the task's current `browserTarget`.
5. Submit the explicit replacement.

```http
POST /api/tasks/:id/rebind-browser-target
```

```json
{
  "expectedBrowserTarget": {
    "mode": "existing-tab",
    "workerId": "bw_old",
    "resourceId": "brr_old"
  },
  "browserTarget": {
    "mode": "existing-tab",
    "workerId": "bw_new",
    "resourceId": "brr_new"
  }
}
```

The Server verifies:

1. The caller owns the task.
2. The caller owns the new Worker and resource.
3. The Worker is online and idle.
4. The resource URL matches the task or handoff URL.
5. The Worker supports rendered DOM and navigation.
6. A handoff Worker also supports human handoff.
7. The stored target still equals `expectedBrowserTarget`.
8. The task is in a recoverable state.

Recoverable states are:

- `waiting_for_browser_worker`
- `interrupted`
- `waiting_verification`
- `failed` only for a classified browser-target loss

`running`, `pending`, `paused`, `completed`, and `cancelled` reject recovery.
URL comparison uses standard URL parsing, normalizes default ports and trailing
root slashes, and ignores the fragment. Query parameters remain significant.

The operation preserves checkpoint, progress, diagnostics, and task identity.
It records `task:browser_target_rebound` in the task detail `events` array.
Repeating the same request returns `200` with `recovery.idempotent: true`.

For `waiting_verification`, the Server closes the old handoff session, retains
the handoff job ID when it still exists, binds it to the new target, and returns
the current `challenge` state. The task remains `waiting_verification` until the
handoff is ready and the caller resumes it.

The endpoint never accepts a Chrome `tabId`. It never selects a Worker for the
caller.

### 5. Human verification handoff

The current API namespace is `/api/challenge-discovery`, but the public crawl
flow treats these records as human verification handoff jobs. Every browser
operation uses the task-bound Browser Worker command session.

Read the handoff job:

```http
GET /api/challenge-discovery/:id
```

Open the task URL through the selected Browser Worker:

```http
POST /api/challenge-discovery/:id/open-browser
```

This opens or reuses the Browser Client's task-bound browser session. Later
inspect, selector-discovery, and verification calls reuse that session.

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

Cancel an in-progress handoff without deleting its record:

```http
POST /api/challenge-discovery/:id/cancel
```

Cancellation is terminal. A pending Worker acquisition is released if it
finishes after cancellation. Acquisition timeout and other runtime errors move
the handoff to `failed`; they do not leave it queued indefinitely.

### 6. AO adapter discovery and review

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

Promotion first fetches the reviewed page through the task-bound Browser Worker.
It runs the draft, stores `page.html` and `expected.json`, and only then enables
the adapter. A fixture or extraction failure leaves the discovery job in
`awaiting_review` and does not register the adapter.

Delete a finished Adapter build job with
`DELETE /api/selector-discovery/:id`. `queued` and `running` jobs must finish
first. Deleting an unapproved job removes its stored implementation and review
artifacts. Clearing a `promoted` job only removes the job record; its immutable
Adapter Catalog package and approved fixture remain available.

Then create the crawl task again.

### 7. Result and previews

```http
GET /api/tasks/:id
GET /api/tasks/:id/preview-file?path=<relative-preview-path>
```

`preview-file` only serves image files under the task output directory.

## Public support APIs

### Browser Client enrollment and sessions

Browser-backed operations use a registered user-side Browser Client. An
SDK client first reads the service document:

```http
GET /.well-known/comiccrawler-browser-client
```

It contains the protocol version, API security mode, enrollment endpoint, and
the single outbound command WebSocket endpoint.

Enroll one Browser Client installation:

```http
POST /api/browser-clients/enroll
X-ComicCrawler-User-Id: alice
Authorization: Bearer <user-api-token>
Content-Type: application/json

{
  "name": "Alice PC",
  "capabilities": {
    "executionMode": "existing-tab",
    "navigation": true,
    "renderedDom": true,
    "humanHandoff": true,
    "responsiveViewport": false
  }
}
```

The user headers are omitted in `public` mode. ComicCrawler returns the
server-assigned `clientId`, `credentialId`, and Browser Client credential once.
The consumer stores this state through its SDK `ClientStateStore`, then uses the
credential for outbound WebSocket connections. Neither the user machine nor
its browser exposes an inbound port.

An existing-tab consumer calls `client.registerResource()` with an opaque local
tab handle. The SDK returns the `resourceId` used by task APIs. ComicCrawler
never receives or persists the browser's native tab ID. The public resource
contains only its opaque ID, Worker ID, URL, optional title, and registration
time.

List the user's Workers before creating a task:

```http
GET /api/browser-workers
```

ComicCrawler reserves one idle Worker when a task starts. It creates the
browser command session and closes it when the task completes. One Worker
executes one task at a time in this version.

`GET /api/browser-resources` lists only resources owned by the requesting user.
Existing-tab targets require one listed resource. Managed-profile targets do
not use resource IDs because their page is created after assignment.

Use these lifecycle endpoints to inspect Workers or manage credentials:

```http
GET /api/browser-clients
GET /api/browser-workers
GET /api/browser-resources
POST /api/browser-clients/{clientId}/credentials/rotate
```

The command WebSocket carries ComicCrawler protocol messages; it does not relay
Playwright. Protect the administrative API and Browser Client credential state.
Use HTTPS/WSS for remote deployments.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/.well-known/comiccrawler-browser-client` | Discover the Browser Client protocol and outbound connection endpoint. |
| `GET` | `/api/status` | Health/status check. |
| `GET` | `/api/adapters` | List registered adapters and capabilities. |
| `POST` | `/api/adapters/chapter-images` | Return stable chapter/page identities and every ordered image URL. |
| `GET` | `/api/adapters/deleted` | List deleted adapters, source deletion status, and restore availability. |
| `GET` | `/api/adapters/:id` | Read adapter detail. |
| `GET` | `/api/adapters/:id/capabilities` | Read Adapter Lab capabilities and fine-grained function descriptors. |
| `GET` | `/api/adapters/:id/implementation` | Read full Adapter Lab implementation source/manifest. |
| `POST` | `/api/adapters/:id/functions/:functionId/test` | Run an Adapter Lab function test against the supplied URL. |
| `POST` | `/api/adapters/:id/drafts` | Create a user-owned editable draft copy. |
| `POST` | `/api/adapters/:id/restore` | Restore a catalog adapter from its last approved version, or a project adapter after its source is restored. |
| `POST` | `/api/adapters/:id/rollback` | Activate a previous or explicitly named approved catalog version. |
| `GET` | `/api/adapters/:id/versions` | List approved catalog versions and the active pointer. |
| `GET` | `/api/adapters/:id/versions/:version/package` | Export the exact immutable package document. |
| `POST` | `/api/adapter-packages/import` | Validate and import a package; inactive unless `activate` is true. |
| `DELETE` | `/api/adapters/:id` | Deactivate a catalog adapter without deleting approved versions; project TypeScript adapter source directories under `backend/src/adapter/sites/` are deleted as a code change. |
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
| `POST` | `/api/browser-clients/enroll` | Enroll a Browser Client and return its credential once. |
| `GET` | `/api/browser-clients` | List visible registered Browser Client identities. |
| `GET` | `/api/browser-workers` | List process-scoped Workers and their availability. |
| `GET` | `/api/browser-resources` | List current-user tabs registered by existing-tab Workers. |
| `DELETE` | `/api/browser-clients/:clientId` | Revoke one Browser Client and disconnect its Workers. |
| `POST` | `/api/browser-clients/:clientId/credentials/rotate` | Rotate one Browser Client credential and return the replacement once. |

Adapter Lab function tests are diagnostic support APIs. The WebUI shows every
capability implemented by the matched adapter. Each function descriptor states
whether it expects a manga or chapter URL. `extractChapterImageUrls`
returns the full `imageUrls` list plus `imageUrlCount`; it does not return a
shortened `firstImageUrls` preview. Test responses may include timing breakdown
entries such as `dom_acquisition`, `extraction`, and `readiness`.
Browser-backed test and chapter-image requests may use the same
`browserTarget` object as crawl tasks. The Server owns and releases their
short-lived browser lease when the request finishes.
Adapter Lab lists Workers and resources, then sends the selected
`browserTarget`. Existing-tab uses an exact `workerId + resourceId` pair.
Managed-profile uses a Worker without a resource ID. Existing-tab resources
must be registered for the exact target URL.

Verified fixture routes also exist for diagnostics:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/dom-readiness/check` | Check whether supplied HTML looks like trusted comic DOM. |
| `POST` | `/api/fixtures/capture` | Capture verified DOM from a ready handoff browser session. |
| `GET` | `/api/fixtures/:domain/:id` | Read captured fixture metadata, optionally with HTML. |
| `POST` | `/api/fixtures/:domain/:id/test-adapter-function` | Test an adapter function against a captured fixture. |
| `GET` | `/api/adapters/:adapterId/versions/:version/fixture` | Read the approved fixture owned by an immutable Adapter version. |
| `POST` | `/api/adapters/:adapterId/versions/:version/fixture/test-adapter-function` | Run one function from that exact version against its fixture. |
| `POST` | `/api/adapters/:adapterId/versions/:version/fixture/verify` | Replay that exact version and compare all approved results. |

The function-test endpoint accepts this request body:

```json
{
  "functionId": "extractChapterImageUrls"
}
```

The verification endpoint needs no request body. Its response includes `passed`,
`expected`, and `actual`. A mismatch returns a normal `200` response with
`passed: false`, so test runners can show the diff.

## Internal or diagnostic endpoints

These routes currently exist but should not be used as the normal crawl API:

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
