# Adapter Capability API

AO writes capability subclasses. ComicCrawler reviews them and assembles the
final `AdapterBase` shell. Do not export an `AdapterBase` subclass from a stage.

## Runtime boundary

- `parseMode` is always `playwright`.
- Browser Client prepares dynamic content before the DOM is supplied.
- Capability methods receive a prepared Cheerio DOM snapshot and `sourceUrl`.
- Virtualized image URLs may use `data-comiccrawler-src` or
  `data-comiccrawler-image-url`.
- Capability code extracts data only. It cannot click, scroll, navigate, fetch,
  access browser globals, or invent data missing from the snapshot.
- Record incomplete or suspicious DOM evidence in review notes.

## Imports

```ts
import type { ChapterInfo, ComicStatus } from '@comiccrawler/shared';
import {
  ChapterImagesCapability,
  CommonCapability,
  MetadataCapability,
  VerificationCapability,
} from '../../base';
```

Import only classes needed by the current stage. ComicCrawler may rewrite the
relative path during promotion.

## Capability methods

Every adapter starts with one site-specific subclass for each of:

```ts
class SiteCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean { return /example\.com/i.test(url); }
}

class SiteVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /cf-chl|cf_clearance|just a moment|checking your browser|captcha|HTTP\s+(?:403|429|503)\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Task waits while the user completes verification in the bound browser session.',
    };
  }
}
```

Do not match the bare word `cloudflare`; normal pages may contain Cloudflare
assets. Never bypass human verification.

Full adapters also implement:

```ts
class SiteMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string;
  extractAuthor(document: unknown, sourceUrl: string): string | undefined;
  extractDescription(document: unknown, sourceUrl: string): string | undefined;
  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined;
  extractTags(document: unknown, sourceUrl: string): string[];
  extractStatus(document: unknown, sourceUrl: string): ComicStatus | undefined;
  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[];
}
```

Every chapter-capable adapter implements:

```ts
class SiteChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[];
}
```

Use `const $ = this.adapter.asCheerio(document)` inside extraction methods.

## Return rules

- Optional missing scalars return `undefined`; missing lists return `[]`.
- `ComicStatus` is `'ongoing' | 'completed' | 'unknown'`, not an enum.
- `ChapterInfo` requires stable `id`, visible `title`, and absolute `url`.
- Derive chapter IDs from stable URL parts, not list position.
- Omit unknown or relative dates. Do not write runtime progress fields.
- Resolve relative URLs with `this.adapter.resolveUrl(sourceUrl, value)`.
- Return the complete chapter/image list present in the supplied DOM.
- Exclude shortcuts, covers, logos, UI assets, ads, and tracking pixels.
- Prefer reader containers and `data-original`, `data-src`, `data-url`,
  `srcset`, then `src` for page images.
- Deduplicate URLs while preserving page order.

## Helpers

- `this.adapter.asCheerio(document)`
- `this.adapter.resolveUrl(base, relative)`
- `this.adapter.extractText($, selector)`
- `this.adapter.extractAttr($, selector, attr)`
- `this.adapter.extractAllText($, selector)`

Helpers may remain in the stage file so reviewers can inspect site-specific
logic.

## Forbidden

- Adapter identity, constructor, handler wiring, or `super(...)` in stage files
- `this.dom`, browser document APIs, filesystem, child processes, `process`
- network side effects, `eval`, `new Function`, or arbitrary scripts
- imports from this Markdown file, `comiccrawler`, or nonexistent `Capability`
