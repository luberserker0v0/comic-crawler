# ComicCrawler User Guide

## Start the app

From the repo root:

```bash
npm install
npm run dev
```

Open the frontend URL printed by the dev launcher, usually:

```text
http://127.0.0.1:5173
```

If that port is unavailable, `npm run dev` prints the fallback frontend URL.

## What the WebUI is for

The WebUI is the primary human workspace. It covers four workflows:

- **Create and manage crawl tasks** - start all-chapter or specific-chapter
  downloads, watch progress, resume blocked tasks, and inspect output.
- **Create adapter tasks** - when a URL has no compatible adapter, queue
  selector discovery so ComicCrawler can produce a reviewed adapter draft.
- **Maintain adapter versions** - review, promote, reject, or roll back adapter
  capability drafts after human inspection.
- **Edit and test adapters** - use Adapter Lab to inspect the full adapter
  implementation, save user-owned drafts, and test fine-grained extraction
  functions against trusted DOM.

The REST API exposes the same crawl backbone for automation, but the WebUI is
the recommended place for review-heavy work such as adapter diagnosis, draft
editing, and human verification.

## Create and manage crawl tasks

Open the dashboard and choose one task mode:

- **All chapters** - enter a manga metadata/catalog URL. ComicCrawler first
  fetches manga metadata and chapter links, then downloads each chapter image.
- **Specific chapters** - enter one or more chapter URLs. ComicCrawler skips
  metadata discovery and directly downloads images from the provided chapter
  pages.

Before creating the task, the UI previews which adapter would be used for the
entered URL.

After creation, use Task Manager to:

- see the current high-level flow stage and detailed stage text;
- inspect extracted metadata, chapter list summaries, checkpoints, and image
  previews;
- pause, cancel, delete, or resume a task when the current status supports it;
- open the output folder for completed or partially completed downloads.

If no adapter matches, or the matched adapter does not support the requested
mode, ComicCrawler queues adapter discovery instead of starting a crawl
immediately.

## Adapter capability behavior

Adapters expose capabilities:

- Metadata - required for all-chapter tasks.
- Chapter images - required for specific-chapter tasks and for all-chapter image
  downloading.
- Verification - used when a matched site requires human verification.

A chapter-only dynamic adapter can download specific chapter URLs but cannot run
all-chapter tasks until metadata selectors are discovered and promoted.

## Create adapter tasks

Adapter discovery starts from normal task creation. Users do not need a separate
"site discovery" entry point:

1. Enter the target URL on the dashboard.
2. ComicCrawler resolves the domain and required capability.
3. If no compatible adapter exists, the system queues selector discovery.
4. Review the produced adapter capability draft before promotion.
5. Retry the original crawl after the adapter is promoted.

All-chapter discovery may augment an existing chapter-only adapter for the same
domain. It should not create a second active adapter for that domain just to add
metadata and chapter-list support.

## Maintain adapter versions

Adapter review and version maintenance are intentionally GUI-first workflows.
Use the adapter management/review screens to inspect drafts, promote approved
changes, reject bad drafts, or roll back a promoted dynamic adapter version.

Do not promote an adapter solely because a test returned some data. Review the
source DOM, readiness result, extracted values, and known risks first. A
challenge page, recommendation card, footer, or partially expanded page is not a
valid source for adapter promotion.

## Adapter Lab

Adapter Lab is for reviewing and testing what an adapter actually implements.
It does not create crawl tasks.

Enter a URL first:

- Manga catalog URL - Adapter Lab unlocks metadata functions such as title,
  author, tags, status, and chapter list extraction.
- Chapter URL - Adapter Lab unlocks chapter image extraction.

Common and verification functions remain available for diagnostics. Functions
that do not match the URL type are locked in the UI, and the Test button is
disabled for those functions.

The implementation panel shows the full adapter source or dynamic selector
manifest. Function selection only chooses the test target; helper functions and
shared constants can still be part of the implementation.

Editable drafts are user-owned copies. Built-in TypeScript drafts can be saved,
reset, discarded, and diffed against the active adapter, but they are not
executed yet. Dynamic manifest drafts can be tested without promoting or
registering them.

Adapter Lab tests use the adapter `parseMode` automatically. If a site requires
human verification, use the verification handoff shown in the test result,
complete verification in the opened browser, then continue the test. Adapter Lab
does not secretly click generic "show all" buttons or rewrite the page before
calling the selected adapter function.

Adapter Lab is for diagnosis and draft testing. It does not create crawl tasks
and does not promote adapter versions by itself.

## Human verification

If a crawl reaches a human verification page, the task becomes
`waiting_verification`. This does not mean the task failed.

To continue:

1. Open the task from Task Manager.
2. Click **Open browser for verification** in the task detail panel.
3. Complete verification in the isolated browser profile.
4. Return to the task detail page and click **Continue**.

ComicCrawler then resumes from the latest checkpoint. While a task is waiting
for verification, it does not occupy a worker slot; other queued tasks can run.

If the verification handoff expired or was removed, the task detail page asks you
to click **Continue** to recreate the handoff before opening the browser again.

## Resume and previews

ComicCrawler stores crawl checkpoints. Completed images are skipped on resume,
and the task detail page shows checkpoint counts and downloaded image previews.

Use **Open output folder** from task details to inspect downloaded files.

## Download folder

The download directory is configured from Settings. Use the browse/open controls
there when available, or edit the path manually.

Downloaded files include the source domain in their path to avoid collisions
between different comic sites that use the same manga or chapter IDs.

## API and CLI entry points

Swagger UI is available from the running backend:

```text
http://127.0.0.1:4100/api-docs
```

Use REST API clients when you need automation without the WebUI. REST polling can
drive the complete crawl flow: resolve adapter, create task, poll status, handle
verification handoff, resume, and read results.

The CLI is intentionally smaller. It is best for simple local operations such as
checking task status, running a direct download with an already registered
adapter, reading config, or running development/evaluation commands. Adapter
review, source editing, draft testing, promotion, rollback, and human-heavy
verification flows should stay in the WebUI.
