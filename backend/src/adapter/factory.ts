import type { IComicAdapter } from '@comiccrawler/shared';
import { AdapterRegistry } from './registry';
import { UrlResolver } from './url-resolver';
import { ComicError, ErrorType } from '../error/types';

export class AdapterFactory {
  private registry: AdapterRegistry;
  private urlResolver: UrlResolver;

  constructor(registry: AdapterRegistry, urlResolver?: UrlResolver) {
    this.registry = registry;
    this.urlResolver = urlResolver ?? new UrlResolver();
  }

  create(url: string): IComicAdapter {
    const adapter = this.registry.findByUrl(url);

    if (!adapter) {
      throw new ComicError(
        `No adapter found for URL: ${url}`,
        ErrorType.ADAPTER_ERROR,
        false,
        { url }
      );
    }

    return adapter;
  }

  createById(adapterId: string): IComicAdapter {
    const adapter = this.registry.get(adapterId);

    if (!adapter) {
      throw new ComicError(
        `Adapter "${adapterId}" not found`,
        ErrorType.ADAPTER_ERROR
      );
    }

    return adapter;
  }

  resolveUrl(url: string): { adapter: IComicAdapter; normalizedUrl: string } {
    const normalized = this.urlResolver.normalize(url);
    const adapter = this.create(normalized);
    return { adapter, normalizedUrl: normalized };
  }

  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  getUrlResolver(): UrlResolver {
    return this.urlResolver;
  }
}
