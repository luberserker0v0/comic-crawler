import type { ChapterInfo, ComicMetadata, ComicStatus } from '@comiccrawler/shared';
import { AdapterBase, ChapterImagesCapability, CommonCapability, MetadataCapability } from '../../base';
import { KURONAVI_SELECTORS } from './selectors';
import { createDefaultExtractionOrchestrator } from '../../../crawler/extraction';
import type { ExtractionContext } from '../../../crawler/extraction';
import { ComicError, ErrorType } from '../../../error/types';
import { buildExtractionFailureContext } from '../../../agent/error-context';
import { KURONAVI_SITE_MANIFEST } from './manifest';

export class KuronaviAdapter extends AdapterBase {
  readonly id = 'kuronavi';
  readonly name = 'Kuronavi';
  readonly domains = ['kuronavi.one'];
  readonly common: KuronaviCommonCapability = new KuronaviCommonCapability(this);
  readonly metadata: KuronaviMetadataCapability = new KuronaviMetadataCapability(this);
  readonly chapterImages: KuronaviChapterImagesCapability = new KuronaviChapterImagesCapability(this);
}

class KuronaviCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?kuronavi\.one\/manga\//.test(url);
  }
}

class KuronaviMetadataCapability extends MetadataCapability {
  private readonly orchestrator = createDefaultExtractionOrchestrator();
  private readonly metadataCache = new WeakMap<object, Map<string, Promise<ComicMetadata>>>();

  async extractTitle(document: unknown, sourceUrl: string): Promise<string> {
    return (await this.getMetadataDocument(document, sourceUrl)).title;
  }

  async extractAuthor(document: unknown, sourceUrl: string): Promise<string | undefined> {
    return (await this.getMetadataDocument(document, sourceUrl)).author;
  }

  async extractDescription(document: unknown, sourceUrl: string): Promise<string | undefined> {
    return (await this.getMetadataDocument(document, sourceUrl)).description;
  }

  async extractCoverUrl(document: unknown, sourceUrl: string): Promise<string | undefined> {
    return (await this.getMetadataDocument(document, sourceUrl)).coverUrl;
  }

  async extractTags(document: unknown, sourceUrl: string): Promise<string[]> {
    return (await this.getMetadataDocument(document, sourceUrl)).tags ?? [];
  }

  async extractStatus(document: unknown, sourceUrl: string): Promise<ComicStatus | undefined> {
    return (await this.getMetadataDocument(document, sourceUrl)).status;
  }

  async extractChapterList(document: unknown, sourceUrl: string): Promise<ChapterInfo[]> {
    return (await this.getMetadataDocument(document, sourceUrl)).chapters;
  }

  private async getMetadataDocument(document: unknown, sourceUrl: string): Promise<ComicMetadata> {
    if (!isObjectLike(document)) {
      return this.extractMetadataDocument(document, sourceUrl);
    }

    let bySourceUrl = this.metadataCache.get(document);
    if (!bySourceUrl) {
      bySourceUrl = new Map<string, Promise<ComicMetadata>>();
      this.metadataCache.set(document, bySourceUrl);
    }

    const cached = bySourceUrl.get(sourceUrl);
    if (cached) return cached;

    const pending = this.extractMetadataDocument(document, sourceUrl).catch((error) => {
      bySourceUrl.delete(sourceUrl);
      throw error;
    });
    bySourceUrl.set(sourceUrl, pending);
    return pending;
  }

  private async extractMetadataDocument(document: unknown, sourceUrl: string): Promise<ComicMetadata> {
    const context: ExtractionContext = {
      $: this.adapter.asCheerio(document),
      baseUrl: sourceUrl,
      selectors: KURONAVI_SELECTORS,
      pageType: 'metadata',
    };
    const result = await this.orchestrator.execute(context);
    if (!result.metadata) {
      throw new ComicError(
        `Metadata extraction returned no result for ${sourceUrl}`,
        ErrorType.PARSING_ERROR,
        false,
        buildExtractionFailureContext({
          adapterId: this.adapter.id,
          manifest: KURONAVI_SITE_MANIFEST,
          pageType: 'metadata',
          url: sourceUrl,
          message: `Metadata extraction returned no result for ${sourceUrl}`,
        })
      );
    }
    return result.metadata;
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

class KuronaviChapterImagesCapability extends ChapterImagesCapability {
  private readonly orchestrator = createDefaultExtractionOrchestrator();

  async extractChapterImageUrls(document: unknown, sourceUrl: string): Promise<string[]> {
    const context: ExtractionContext = {
      $: this.adapter.asCheerio(document),
      baseUrl: sourceUrl,
      selectors: KURONAVI_SELECTORS,
      pageType: 'images',
    };
    try {
      const images = await this.orchestrator.getStrategy('dom')?.extractImages(context);
      return images?.map((image) => image.url) ?? [];
    } catch (error) {
      if (error instanceof ComicError) {
        throw new ComicError(
          error.message,
          error.type,
          error.recoverable,
          buildExtractionFailureContext({
            adapterId: this.adapter.id,
            manifest: KURONAVI_SITE_MANIFEST,
            pageType: 'images',
            selector: typeof error.context.selector === 'string' ? error.context.selector : undefined,
            selectorName: typeof error.context.selectorName === 'string' ? error.context.selectorName : undefined,
            url: sourceUrl,
            message: error.message,
          })
        );
      }

      throw new ComicError(
        error instanceof Error ? error.message : String(error),
        ErrorType.PARSING_ERROR,
        false,
        buildExtractionFailureContext({
          adapterId: this.adapter.id,
          manifest: KURONAVI_SITE_MANIFEST,
          pageType: 'images',
          url: sourceUrl,
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}
