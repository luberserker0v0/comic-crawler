import { BaseAdapter } from '../../base';
import type { ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import { KURONAVI_SELECTORS } from './selectors';
import { createDefaultExtractionOrchestrator } from '../../../crawler/extraction';
import type { ExtractionContext } from '../../../crawler/extraction';
import { ComicError, ErrorType } from '../../../error/types';
import { buildExtractionFailureContext } from '../../../agent/error-context';
import { KURONAVI_SITE_MANIFEST } from './manifest';

export class KuronaviAdapter extends BaseAdapter {
  readonly id = 'kuronavi';
  readonly name = 'Kuronavi';
  readonly domains = ['kuronavi.one'];

  private readonly orchestrator = createDefaultExtractionOrchestrator();

  matchUrl(url: string): boolean {
    return /^https?:\/\/(www\.)?kuronavi\.one\/manga\//.test(url);
  }

  async fetchMetadata(url: string): Promise<ComicMetadata> {
    const html = await this.fetchHtml(url);
    const context = this.createContext(html, url, 'metadata');
    let result;
    try {
      result = await this.orchestrator.execute(context);
    } catch (error) {
      throw this.wrapExtractionError(error, url, 'metadata', html);
    }

    if (!result.metadata) {
      throw new ComicError(
        `Metadata extraction returned no result for ${url}`,
        ErrorType.PARSING_ERROR,
        false,
        buildExtractionFailureContext({
          adapterId: this.id,
          manifest: KURONAVI_SITE_MANIFEST,
          pageType: 'metadata',
          url,
          html,
          message: `Metadata extraction returned no result for ${url}`,
        })
      );
    }

    return result.metadata;
  }

  async fetchChapterImages(chapterUrl: string): Promise<ImageInfo[]> {
    const html = await this.fetchHtml(chapterUrl);
    const context = this.createContext(html, chapterUrl, 'images');
    let images;
    try {
      images = await this.orchestrator.getStrategy('dom')?.extractImages(context);
    } catch (error) {
      throw this.wrapExtractionError(error, chapterUrl, 'images', html);
    }

    if (!images || images.length === 0) {
      throw new ComicError(
        `Image extraction returned no result for ${chapterUrl}`,
        ErrorType.PARSING_ERROR,
        false,
        buildExtractionFailureContext({
          adapterId: this.id,
          manifest: KURONAVI_SITE_MANIFEST,
          pageType: 'images',
          url: chapterUrl,
          html,
          message: `Image extraction returned no result for ${chapterUrl}`,
        })
      );
    }

    return images;
  }

  private createContext(html: string, baseUrl: string, pageType: ExtractionContext['pageType']): ExtractionContext {
    return {
      $: this.parseHtml(html),
      baseUrl,
      selectors: KURONAVI_SELECTORS,
      pageType,
    };
  }

  private wrapExtractionError(
    error: unknown,
    url: string,
    pageType: 'metadata' | 'images',
    html: string
  ): ComicError {
    if (error instanceof ComicError) {
      return new ComicError(
        error.message,
        error.type,
        error.recoverable,
        buildExtractionFailureContext({
          adapterId: this.id,
          manifest: KURONAVI_SITE_MANIFEST,
          pageType,
          selector: typeof error.context.selector === 'string' ? error.context.selector : undefined,
          selectorName: typeof error.context.selectorName === 'string' ? error.context.selectorName : undefined,
          url,
          html,
          message: error.message,
        })
      );
    }

    return new ComicError(
      error instanceof Error ? error.message : String(error),
      ErrorType.PARSING_ERROR,
      false,
      buildExtractionFailureContext({
        adapterId: this.id,
        manifest: KURONAVI_SITE_MANIFEST,
        pageType,
        url,
        html,
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }
}
