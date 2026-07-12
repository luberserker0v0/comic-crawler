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

## Create a crawl task

Open the dashboard and choose one task mode:

- **All chapters** - enter a manga metadata/catalog URL. ComicCrawler first
  fetches manga metadata and chapter links, then downloads each chapter image.
- **Specific chapters** - enter one or more chapter URLs. ComicCrawler skips
  metadata discovery and directly downloads images from the provided chapter
  pages.

Before creating the task, the UI previews which adapter would be used for the
entered URL. If no adapter matches, ComicCrawler queues adapter discovery instead
of starting a crawl immediately.

## Adapter capability behavior

Adapters expose capabilities:

- Metadata - required for all-chapter tasks.
- Chapter images - required for specific-chapter tasks and for all-chapter image
  downloading.
- Verification - used when a matched site requires human verification.

A chapter-only dynamic adapter can download specific chapter URLs but cannot run
all-chapter tasks until metadata selectors are discovered and promoted.

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
