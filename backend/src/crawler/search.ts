import type { SearchResult, SearchOptions } from '@comiccrawler/shared';
import type { AdapterBase } from '../adapter/base';
import type { HtmlParser } from './html-parser';
import { ComicError, ErrorType } from '../error/types';

export interface SearchEngineOptions {
  searchUrlTemplate?: string;
  resultSelector?: string;
  titleSelector?: string;
  urlSelector?: string;
}

export class SearchEngine {
  private parser: HtmlParser;

  constructor(parser: HtmlParser) {
    this.parser = parser;
  }

  async search(adapter: AdapterBase, query: string, options?: SearchOptions & SearchEngineOptions): Promise<SearchResult[]> {
    if (adapter.search) {
      return adapter.search(query, options);
    }

    const searchUrl = options?.searchUrlTemplate?.replace('{query}', encodeURIComponent(query));
    if (!searchUrl) {
      throw new ComicError(
        `Adapter "${adapter.id}" does not support search and no searchUrlTemplate provided`,
        ErrorType.ADAPTER_ERROR
      );
    }

    const html = await adapter.fetchHtml(searchUrl);
    const $ = this.parser.parse(html);

    const resultSelector = options?.resultSelector ?? '.search-result';
    const titleSelector = options?.titleSelector ?? '.title';
    const urlSelector = options?.urlSelector ?? 'a';

    const results: SearchResult[] = [];
    const items = $(resultSelector);

    items.each((i, el) => {
      const $el = $(el);
      const title = $el.find(titleSelector).first().text().trim();
      const url = $el.find(urlSelector).first().attr('href');

      if (title && url) {
        results.push({
          id: `search-${i}`,
          title,
          url,
          coverUrl: $el.find('img').first().attr('src'),
        });
      }
    });

    return results;
  }

  async searchMultiple(adapters: AdapterBase[], query: string, options?: SearchOptions & SearchEngineOptions): Promise<Record<string, SearchResult[]>> {
    const results: Record<string, SearchResult[]> = {};

    const searchPromises = adapters.map(async (adapter) => {
      try {
        results[adapter.id] = await this.search(adapter, query, options);
      } catch {
        results[adapter.id] = [];
      }
    });

    await Promise.all(searchPromises);
    return results;
  }
}
