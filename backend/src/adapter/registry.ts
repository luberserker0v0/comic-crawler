import type { AdapterCapabilities, IComicAdapter } from '@comiccrawler/shared';
import type { EventBus } from '../events/bus';
import { ComicError, ErrorType } from '../error/types';

export function getAdapterCapabilities(adapter: IComicAdapter): AdapterCapabilities {
  return adapter.capabilities ?? {
    verification: false,
    metadata: true,
    chapterImages: true,
  };
}

export class AdapterRegistry {
  private adapters = new Map<string, IComicAdapter>();
  private eventBus?: EventBus;

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus;
  }

  register(adapter: IComicAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new ComicError(
        `Adapter "${adapter.id}" is already registered`,
        ErrorType.ADAPTER_ERROR
      );
    }

    this.adapters.set(adapter.id, adapter);
    this.eventBus?.emit('adapter:registered', { adapterId: adapter.id });
  }

  unregister(adapterId: string): void {
    if (!this.adapters.has(adapterId)) {
      throw new ComicError(
        `Adapter "${adapterId}" is not registered`,
        ErrorType.ADAPTER_ERROR
      );
    }

    this.adapters.delete(adapterId);
  }

  get(adapterId: string): IComicAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  getAll(): IComicAdapter[] {
    return Array.from(this.adapters.values());
  }

  list(): Array<{ id: string; name: string; domains: string[]; capabilities: AdapterCapabilities }> {
    return this.getAll().map((a) => ({
      id: a.id,
      name: a.name,
      domains: a.domains,
      capabilities: getAdapterCapabilities(a),
    }));
  }

  findByUrl(url: string): IComicAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.matchUrl(url)) {
        return adapter;
      }
    }

    return undefined;
  }

  findByUrlWithCapabilities(url: string, required: Partial<AdapterCapabilities>): IComicAdapter | undefined {
    return this.getAll()
      .filter((adapter) => adapter.matchUrl(url))
      .find((adapter) => {
        const capabilities = getAdapterCapabilities(adapter);
        return Object.entries(required).every(([key, value]) =>
          value === undefined || capabilities[key as keyof AdapterCapabilities] === value
        );
      });
  }

  has(adapterId: string): boolean {
    return this.adapters.has(adapterId);
  }

  get size(): number {
    return this.adapters.size;
  }

  clear(): void {
    this.adapters.clear();
  }
}
