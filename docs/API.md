# ComicCrawler API Reference

This document tracks the currently implemented backend routes. The default local
backend base URL is:

```text
http://127.0.0.1:4100/api
```

All JSON responses use:

```json
{ "data": "..." }
```

Errors use:

```json
{ "error": "message" }
```

Authentication middleware exists in code but is not registered in the default
local server.

## Tasks

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tasks` | List tasks and aggregate status counts. |
| `POST` | `/api/tasks` | Create a crawl task or queue adapter/challenge discovery when no usable adapter is available. |
| `GET` | `/api/tasks/:id` | Read task detail, result, checkpoint summary, progress, and preview metadata. |
| `POST` | `/api/tasks/:id/pause` | Pause a task when supported by the task manager. |
| `POST` | `/api/tasks/:id/resume` | Resume a paused/interrupted/waiting-verification task from checkpoint. |
| `POST` | `/api/tasks/:id/cancel` | Cancel a task. |
| `DELETE` | `/api/tasks/:id` | Delete a task, including `waiting_verification` tasks. |
| `GET` | `/api/tasks/:id/preview-file` | Read a downloaded preview file under the task output directory. |
| `GET` | `/api/tasks/priority-order` | Read the forced task order table. |
| `PUT` | `/api/tasks/priority-order` | Replace the forced task order table. |

`POST /api/tasks` accepts all-chapter and chapter-only modes. If a matching
adapter lacks required capabilities, the response can queue selector discovery
instead of creating a crawl task.

`waiting_verification` is a resumable state, not a failed state. The worker slot
is released while the user completes verification.

## Adapters

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/adapters` | List registered adapters and capabilities. |
| `GET` | `/api/adapters/:id` | Read adapter detail. |
| `POST` | `/api/adapters/resolve` | Preview which adapter would handle a URL and whether it covers the requested mode. |
| `POST` | `/api/adapters/register` | Register a dynamic adapter manifest. Mainly used by tests and internal flows. |

Adapter capabilities:

- `metadata` - can fetch manga metadata and chapter list.
- `chapterImages` - can fetch images from chapter URLs.
- `verification` - can participate in human verification handoff.

Built-in adapters take priority over dynamic adapters. A chapter-only dynamic
adapter can serve specific-chapter tasks but cannot serve all-chapter tasks.

## Config

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Read global config. |
| `PUT` | `/api/config` | Update global config. |
| `POST` | `/api/config/reset` | Reset global config. |
| `POST` | `/api/config/download-directory/browse` | Ask the local app environment for a download directory path. |
| `POST` | `/api/config/download-directory/open` | Open a configured download directory. |
| `GET` | `/api/config/sites` | List per-site config. |
| `GET` | `/api/config/sites/:adapterId` | Read per-site config. |
| `PUT` | `/api/config/sites/:adapterId` | Update per-site config. |
| `GET` | `/api/config/blacklist` | List blacklist rules. |
| `POST` | `/api/config/blacklist` | Add a blacklist rule. |
| `DELETE` | `/api/config/blacklist/:id` | Delete a blacklist rule. |

Runtime process settings can also come from environment variables documented in
the root README.

## Selector discovery config

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config/selector-discovery` | Read selector discovery settings without provider secrets. |
| `PUT` | `/api/config/selector-discovery` | Save AO URL, provider document, and selected model. |
| `POST` | `/api/config/selector-discovery/test` | Test AO connectivity/settings. |
| `DELETE` | `/api/config/selector-discovery/provider` | Clear provider/model settings. |
| `GET` | `/api/config/selector-discovery/bundle-status` | Read active/draft selector-discovery bundle status. |
| `GET` | `/api/config/selector-discovery/bundle-evaluations` | List bundle evaluation results. |

Provider options and token paths are treated as settings-layer secrets and are
not returned by read APIs.

## Challenge discovery

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/challenge-discovery` | Create a browser challenge discovery job. |
| `GET` | `/api/challenge-discovery` | List challenge discovery jobs. |
| `GET` | `/api/challenge-discovery/:id` | Read a challenge discovery job. |
| `POST` | `/api/challenge-discovery/:id/retry` | Retry a challenge discovery job. |
| `POST` | `/api/challenge-discovery/:id/promote` | Promote a validated challenge strategy. |
| `POST` | `/api/challenge-discovery/:id/open-external-browser` | Open the isolated browser handoff used by the WebUI task-detail flow. |
| `POST` | `/api/challenge-discovery/:id/complete-human-verification` | Check whether human verification is complete. |
| `GET` | `/api/challenge-discovery/browser-options` | Detect local browser executables for handoff. |
| `POST` | `/api/challenge-discovery/browser-options/browse-executable` | Browse for a local browser executable. |

Diagnostic and test-oriented endpoints also exist:

- `POST /api/challenge-discovery/cdp/test`
- `POST /api/challenge-discovery/:id/open-browser`
- `POST /api/challenge-discovery/:id/inspect-cdp-page`
- `POST /api/challenge-discovery/:id/create-selector-discovery-from-cdp`

They are not the primary user handoff path.

## Agent adapter review

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/agent/adapters` | List dynamic adapter candidates/review state. |
| `GET` | `/api/agent/adapters/:id` | Read adapter candidate detail. |
| `POST` | `/api/agent/adapters/:id/promote` | Promote a reviewed adapter candidate. |
| `POST` | `/api/agent/adapters/:id/reject` | Reject a candidate. |
| `POST` | `/api/agent/adapters/:id/rollback` | Roll back a dynamic adapter when supported. |

## Search and status

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/search` | Search through configured search support. |
| `GET` | `/api/status` | Health/status check used by `npm run dev`. |

## WebSocket

The development frontend proxies WebSocket traffic through:

```text
ws://127.0.0.1:4100/ws
```

Task events include progress, completion, failure, cancellation, pause/resume,
waiting verification, and image-downloaded updates. The WebUI uses these events
to refresh task status and previews.
