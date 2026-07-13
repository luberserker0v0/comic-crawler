# AdapterBase API Reference

Use this reference when writing `outputs/adapter-implementation.ts`.

Before writing the composed adapter, follow `contracts/capability-pipeline.md`.
Every adapter starts with `CommonCapability` and `VerificationCapability`.

## Imports

Use this import style:

```ts
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import {
  AdapterBase,
  ChapterImagesCapability,
  CommonCapability,
  MetadataCapability,
  VerificationCapability,
} from '../../base';
```

The exact relative import path may be adjusted by ComicCrawler during review or
promotion. The class names, method names, and return shapes are the important
contract.

Do not import `Capability`, `comiccrawler`, or `./capabilities`. Those APIs do
not exist in ComicCrawler adapter drafts.
Do not import from `contracts/adapter-base-api.md` or
`./contracts/adapter-base-api`. This file is documentation, not runtime code.

## Site adapter shell

The TypeScript file must export exactly one adapter class:

```ts
export class ExampleSiteAdapter extends AdapterBase {
  readonly id = 'example-site';
  readonly name = 'Example Site';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = {
    verification: true,
    metadata: true,
    chapterImages: true,
  };

  readonly common = new ExampleCommonCapability(this);
  readonly verification = new ExampleVerificationCapability(this);
  readonly metadata = new ExampleMetadataCapability(this);
  readonly chapterImages = new ExampleChapterImagesCapability(this);
}
```

Do not put adapter identity or capabilities in `constructor()` or `super(...)`.
`AdapterBase` does not accept an identity object. Adapter identity must be
declared as readonly class fields as shown above.
Do not write a constructor only to call `super(...)`. If no constructor is
needed, omit it completely.
`capabilities` is a boolean object only. Do not put `new CommonCapability()` or
other handler instances inside `capabilities`. Handler instances must be separate
readonly fields named `common`, `verification`, `metadata`, and `chapterImages`.
Do not instantiate `CommonCapability`, `VerificationCapability`,
`MetadataCapability`, or `ChapterImagesCapability` directly. They are base
classes. Create site-specific subclasses such as
`ExampleCommonCapability extends CommonCapability`.
Do not combine capability handlers with `implements`. Each capability needs its
own site-specific subclass and its own readonly handler field.
Do not write extraction methods directly on the adapter shell class. The adapter
shell only declares identity, capability flags, and handler fields. Fine-grained
extraction methods belong in the capability handler subclasses.

`parseMode` means:

- `static`: ComicCrawler can use static HTML fetch first.
- `dynamic`: ComicCrawler should use rendered DOM first.
- `interactive`: ComicCrawler should use rendered DOM plus official human
  verification handoff when blocked.

## Common capability

```ts
class ExampleCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return /^https?:\/\/example\.com\/(?:manga|read)\//i.test(url);
  }
}
```

`matchUrl(url)` must return true for every URL the adapter supports and false
for unrelated URLs on other domains or unsupported paths.

## Verification capability

Every adapter implements this capability. It is the DOM trust gate. If no
verification is observed, return `false` for normal DOM and still detect generic
blocked/challenge signals:

```ts
class ExampleVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|blocked|challenge|HTTP\s+(?:403|429|503)\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Task enters waiting_verification and the user completes verification through the task detail handoff.',
    };
  }
}
```

Do not bypass CAPTCHA, Cloudflare, browser fingerprinting, or any human
verification. Only detect that handoff is required. ComicCrawler will use the
official Task Detail handoff when a human needs to complete verification.

## Metadata capability

Full adapters implement metadata. Chapter-only adapters do not.

Use these exact method names. Do not rename them to `matchTitle`,
`matchChapterList`, `matchChapterImageUrls`, or similar:

- `extractTitle`
- `extractAuthor`
- `extractDescription`
- `extractCoverUrl`
- `extractTags`
- `extractStatus`
- `extractChapterList`

```ts
class ExampleMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    const $ = this.adapter.asCheerio(document);
    return $('main h1').first().text().replace(/\s+/g, ' ').trim();
  }

  extractAuthor(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    return $('.author a').first().text().trim() || undefined;
  }

  extractDescription(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    return $('.description').first().text().replace(/\s+/g, ' ').trim() || undefined;
  }

  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined {
    const $ = this.adapter.asCheerio(document);
    const raw = $('.cover img').first().attr('data-src') ?? $('.cover img').first().attr('src');
    return raw ? this.adapter.resolveUrl(sourceUrl, raw) : undefined;
  }

  extractTags(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    return $('.tags a')
      .map((_, element) => $(element).text().trim())
      .get()
      .filter(Boolean);
  }

  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined {
    const $ = this.adapter.asCheerio(document);
    const text = $('.status').first().text();
    if (/complete|completed|完結|已完結|完结|已完结/i.test(text)) return 'completed';
    if (/ongoing|連載|連載中|连载|连载中|更新中/i.test(text)) return 'ongoing';
    return 'unknown';
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    const seen = new Set<string>();
    const chapters: ChapterInfo[] = [];

    $('.chapter-list a[href*="/read/"]').each((_, element) => {
      const node = $(element);
      const rawHref = node.attr('href') ?? '';
      if (!rawHref) return;
      const url = this.adapter.resolveUrl(sourceUrl, rawHref);
      if (seen.has(url)) return;
      seen.add(url);
      chapters.push({
        id: new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? `chapter-${chapters.length + 1}`,
        title: node.text().replace(/\s+/g, ' ').trim() || `Chapter ${chapters.length + 1}`,
        url,
        number: chapters.length + 1,
      });
    });

    return chapters;
  }
}
```

Metadata extraction rules:

- Every metadata method receives `(document: unknown, sourceUrl: string)`.
- Convert `document` with `const $ = this.adapter.asCheerio(document);`.
- Do not use `this.dom`, `.select(...)`, or browser-like document APIs.
- Prefer detail-page title signals such as `main h1`, detail title classes, or
  Open Graph title. Do not use recommendation card titles, footer titles,
  rating labels, or generic page headings.
- `extractChapterList` must return the full known catalog from the provided DOM.
  Do not return a preview, sample, first few chapters, shortcut links, start
  reading links, next/previous links, or recommendation links.
- If the DOM only contains a collapsed/partial chapter list, implement visible
  extraction honestly and document the risk in review notes. Do not invent
  missing chapters.
- Chapter URLs must be absolute URLs.

## Chapter image capability

All chapter-capable adapters implement this:

Use the exact method name `extractChapterImageUrls`. Do not rename it to
`matchChapterImageUrls`, `getImages`, or similar.

```ts
class ExampleChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    const seen = new Set<string>();
    const urls: string[] = [];

    $('.reader img, .chapter-content img').each((_, element) => {
      const node = $(element);
      const raw = node.attr('data-original')
        ?? node.attr('data-src')
        ?? node.attr('data-url')
        ?? node.attr('src')
        ?? '';
      if (!raw || raw.startsWith('data:')) return;
      const url = this.adapter.resolveUrl(sourceUrl, raw);
      if (seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });

    return urls;
  }
}
```

Image extraction rules:

- `extractChapterImageUrls` receives `(document: unknown, sourceUrl: string)`.
- Convert `document` with `const $ = this.adapter.asCheerio(document);`.
- Do not use `this.dom`, `.select(...)`, or browser-like document APIs.
- Return all comic page image URLs from the provided reader DOM.
- Do not return a preview, first-image list, cover image, logo, icon, app promo,
  ad, tracking pixel, or recommendation image.
- Prefer reader containers and lazy-loading attributes over broad selectors.
- Use helper functions when useful, but keep helpers in the same TypeScript file
  so the review UI shows the full site-specific strategy.

## Useful AdapterBase helpers

Inside capability classes, use:

- `this.adapter.asCheerio(document)` to obtain the Cheerio API.
- `this.adapter.resolveUrl(sourceUrl, rawUrl)` to turn relative URLs into
  absolute URLs.
- `this.adapter.extractText($, selector)` for simple first text extraction.
- `this.adapter.extractAttr($, selector, attr)` for simple first attribute
  extraction.
- `this.adapter.extractAllText($, selector)` for text arrays.

Do not call network APIs, filesystem APIs, child processes, `process`, `eval`, or
`new Function` from adapter implementation drafts.

## Common invalid patterns

Reject these patterns in your own draft before writing output:

```ts
import { AdapterBase, Capability } from "comiccrawler";
import { CommonCapability } from "./capabilities";

export class BadAdapter extends AdapterBase {
  constructor() {
    super({ id: "bad", capabilities: [] });
  }

  extractTitle(): string {
    return this.dom.select("h1").text();
  }
}
```

Why invalid:

- `Capability` is not part of the adapter contract.
- `comiccrawler` and `./capabilities` are not valid draft imports.
- `contracts/adapter-base-api.md` is documentation, not an import target.
- Identity must be readonly fields, not `super(...)` options.
- The adapter shell must not implement extraction methods directly.
- Capability handlers must be site-specific subclasses, not direct
  instantiations of abstract base classes.
- Extraction methods must accept `(document, sourceUrl)`.
- Extraction method names must start with `extract`, not `match`.
- `capabilities` must be boolean flags, not capability handler instances.
- Use Cheerio via `this.adapter.asCheerio(document)`, not `this.dom`.
