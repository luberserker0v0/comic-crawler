import type { ChapterInfo, ComicMetadata, ComicStatus } from '@comiccrawler/shared';
import { AdapterBase, ChapterImagesCapability, CommonCapability, MetadataCapability,
  ReaderPreparationCapability } from '../../base';
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
  readonly readerPreparation: KuronaviReaderPreparationCapability = new KuronaviReaderPreparationCapability(this);
  readonly chapterImages: KuronaviChapterImagesCapability = new KuronaviChapterImagesCapability(this);
}

class KuronaviCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?kuronavi\.one\/manga\//.test(url);
  }
}

class KuronaviReaderPreparationCapability extends ReaderPreparationCapability {
  getReaderContainerSelector(sourceUrl: string): string | undefined {
    return /\/chapter-/i.test(new URL(sourceUrl).pathname) ? KURONAVI_SELECTORS.images.container : undefined;
  }
  getReaderPageSelector(sourceUrl: string): string | undefined {
    return /\/chapter-/i.test(new URL(sourceUrl).pathname) ? KURONAVI_SELECTORS.images.item : undefined;
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
    const context = extractionContext(this.adapter, document, sourceUrl, 'metadata');
    const result = await this.orchestrator.execute(context);
    if (!result.metadata) throw extractionError(this.adapter.id, sourceUrl, 'metadata');
    return result.metadata;
  }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

class KuronaviChapterImagesCapability extends ChapterImagesCapability {
  private readonly orchestrator = createDefaultExtractionOrchestrator();

  async extractChapterImageUrls(document: unknown, sourceUrl: string): Promise<string[]> {
    const context = extractionContext(this.adapter, document, sourceUrl, 'images');
    try {
      const images = await this.orchestrator.getStrategy('dom')?.extractImages(context);
      return images?.map((image) => image.url) ?? [];
    } catch (error) {
      throw wrapExtractionError(this.adapter.id, sourceUrl, error);
    }
  }
}

function extractionContext(adapter: AdapterBase, document: unknown, baseUrl: string,
  pageType: 'metadata' | 'images'): ExtractionContext {
  return { $: adapter.asCheerio(document), baseUrl, selectors: KURONAVI_SELECTORS, pageType };
}

function extractionError(adapterId: string, url: string, pageType: 'metadata' | 'images', message?: string): ComicError {
  const detail = message ?? `Metadata extraction returned no result for ${url}`;
  return new ComicError(detail, ErrorType.PARSING_ERROR, false, buildExtractionFailureContext({
    adapterId, manifest: KURONAVI_SITE_MANIFEST, pageType, url, message: detail,
  }));
}

function wrapExtractionError(adapterId: string, url: string, error: unknown): ComicError {
  if (!(error instanceof ComicError)) return extractionError(adapterId, url, 'images', error instanceof Error ? error.message : String(error));
  return new ComicError(error.message, error.type, error.recoverable, buildExtractionFailureContext({
    adapterId, manifest: KURONAVI_SITE_MANIFEST, pageType: 'images',
    selector: typeof error.context.selector === 'string' ? error.context.selector : undefined,
    selectorName: typeof error.context.selectorName === 'string' ? error.context.selectorName : undefined,
    url, message: error.message,
  }));
}
