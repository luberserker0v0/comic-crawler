# Reliability guide

ComicCrawler treats a crawl task as resumable work. The backend keeps enough
runtime state to avoid restarting from zero after human verification, transient
download failures, or a backend restart.

## Task checkpoint

Each task can persist a checkpoint with the current chapter, completed image
count, failed image count, resumable flag, and last update time. Task detail
responses expose this summary so WebUI and REST clients can show whether a task
can continue.

When a task resumes, the crawler should prefer checkpoint state over starting a
fresh run. Completed images are skipped when their output file already exists.
Partial files may be retried or replaced safely by the downloader.

## Human verification handoff

If a crawl reaches a page that requires human verification, the task enters
`waiting_verification`. This state is not a task failure. The worker slot is
released so other pending tasks can continue.

The user completes verification from the task detail page by opening the
isolated verification browser. After verification succeeds, `POST
/api/tasks/:id/resume` puts the task back into the queue. If the verification
session is stale or missing, the resume API returns a conflict and tells the
client which handoff step is still required.

## Queue behavior

`waiting_verification` tasks do not occupy workers. Pending tasks are selected
by the forced priority order first, then by normal task priority.

The forced order is managed through:

- `GET /api/tasks/priority-order`
- `PUT /api/tasks/priority-order`

This is useful when the user wants task A to run before task B regardless of
their numeric priority.

## Download reliability

Image downloads are intended to be idempotent:

- existing completed files are skipped;
- failed images are counted individually;
- transient failures can be retried without recreating the task;
- a single failed image should not invalidate already downloaded images.

Preview files are exposed from task detail and WebSocket download events so the
UI can show progress as images arrive.

## Adapter lifecycle reliability

Adapters are active runtime components. Deleting an adapter immediately removes
it from the registry and writes a deleted marker. If the adapter came from a
generated selector manifest or generated TypeScript implementation, ComicCrawler
keeps the deleted runtime record so it can be restored later.

If the adapter came from project TypeScript source, deleting it also removes the
source directory under `backend/src/adapter/sites/`. ComicCrawler does not
recreate that source. Restore the source with git first, then restore the
adapter from the deleted adapter list.

