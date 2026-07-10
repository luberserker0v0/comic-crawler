import type { AdapterCapabilities, ChapterInfo, ComicStatus, SiteSelectors } from '@comiccrawler/shared';
import {
  AdapterBase,
  ChapterImagesCapability,
  CommonCapability,
  MetadataCapability,
} from './base';
import { ComicError, ErrorType } from '../error/types';

type DynamicSiteSelectors = Partial<SiteSelectors> & {
  images: SiteSelectors['images'];
};

export interface DynamicSiteAdapterManifest {
  adapterId: string;
  name: string;
  domains: string[];
  urlPatterns: string[];
  capabilities?: Partial<AdapterCapabilities>;
  selectors: DynamicSiteSelectors;
  sourceDiscoveryId: string;
  promotedAt: string;
}

export class DynamicSiteAdapter extends AdapterBase {
  readonly id: string;
  readonly name: string;
  readonly domains: string[];
  readonly parseMode = 'dynamic' as const;
  readonly capabilities: AdapterCapabilities;
  readonly common: DynamicCommonCapability;
  readonly metadata: DynamicMetadataCapability;
  readonly chapterImages: DynamicChapterImagesCapability;

  constructor(private readonly manifest: DynamicSiteAdapterManifest) {
    super();
    this.id = manifest.adapterId;
    this.name = manifest.name || manifest.adapterId;
    this.domains = manifest.domains;
    this.capabilities = {
      verification: true,
      metadata: true,
      chapterImages: true,
      ...manifest.capabilities,
    };
    this.common = new DynamicCommonCapability(this, manifest);
    this.metadata = new DynamicMetadataCapability(this, manifest);
    this.chapterImages = new DynamicChapterImagesCapability(this, manifest);
  }

  getManifest(): DynamicSiteAdapterManifest {
    return this.manifest;
  }
}

class DynamicCommonCapability extends CommonCapability {
  constructor(
    adapter: DynamicSiteAdapter,
    private readonly manifest: DynamicSiteAdapterManifest
  ) {
    super(adapter);
  }

  matchUrl(url: string): boolean {
    const parsed = new URL(url);
    if (!this.manifest.domains.includes(parsed.hostname)) return false;
    if (this.manifest.urlPatterns.length === 0) return true;
    return this.manifest.urlPatterns.some((pattern) => wildcardToRegex(pattern).test(url));
  }
}

class DynamicMetadataCapability extends MetadataCapability {
  constructor(
    adapter: DynamicSiteAdapter,
    private readonly manifest: DynamicSiteAdapterManifest
  ) {
    super(adapter);
  }

  extractTitle(document: unknown, _sourceUrl: string): string {
    if (!this.adapter.capabilities.metadata) {
      throw this.unsupportedCapability('metadata', 'extractTitle');
    }
    return this.adapter.extractText(this.adapter.asCheerio(document), this.requiredMetadataSelectors().title);
  }

  extractAuthor(document: unknown, _sourceUrl: string): string | undefined {
    if (!this.adapter.capabilities.metadata) return undefined;
    const selector = this.manifest.selectors.metadata?.author;
    return selector ? this.adapter.extractText(this.adapter.asCheerio(document), selector) || undefined : undefined;
  }

  extractDescription(document: unknown, _sourceUrl: string): string | undefined {
    if (!this.adapter.capabilities.metadata) return undefined;
    const selector = this.manifest.selectors.metadata?.description;
    return selector ? this.adapter.extractText(this.adapter.asCheerio(document), selector) || undefined : undefined;
  }

  extractCoverUrl(document: unknown, sourceUrl: string): string | undefined {
    if (!this.adapter.capabilities.metadata) return undefined;
    const selector = this.manifest.selectors.metadata?.cover;
    if (!selector) return undefined;
    const $ = this.adapter.asCheerio(document);
    const value = this.adapter.extractAttr($, selector, 'src') || this.adapter.extractAttr($, selector, 'content');
    return value ? this.adapter.resolveUrl(sourceUrl, value) : undefined;
  }

  extractTags(document: unknown, _sourceUrl: string): string[] {
    if (!this.adapter.capabilities.metadata) return [];
    const selector = this.manifest.selectors.metadata?.tags;
    return selector ? this.adapter.extractAllText(this.adapter.asCheerio(document), selector) : [];
  }

  extractStatus(document: unknown, _sourceUrl: string): ComicStatus | undefined {
    if (!this.adapter.capabilities.metadata) return undefined;
    const selector = this.manifest.selectors.metadata?.status;
    const value = selector ? this.adapter.extractText(this.adapter.asCheerio(document), selector).toLowerCase() : '';
    if (/completed|complete|完結|已完結/.test(value)) return 'completed';
    if (/ongoing|連載|連載中/.test(value)) return 'ongoing';
    return undefined;
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    if (!this.adapter.capabilities.metadata) {
      throw this.unsupportedCapability('metadata', 'extractChapterList');
    }
    const $ = this.adapter.asCheerio(document);
    const chapterSelectors = this.requiredChapterSelectors();
    return $(chapterSelectors.list)
      .find(chapterSelectors.item)
      .map((index, element) => {
        const item = $(element);
        const link = chapterSelectors.url ? item.find(chapterSelectors.url).addBack(chapterSelectors.url).first() : item;
        const titleNode = chapterSelectors.title ? item.find(chapterSelectors.title).addBack(chapterSelectors.title).first() : item;
        const href = link.attr('href') ?? '';
        return {
          id: href || String(index),
          title: titleNode.text().trim() || `Chapter ${index + 1}`,
          url: href ? this.adapter.resolveUrl(sourceUrl, href) : sourceUrl,
          index,
        };
      })
      .get();
  }

  private requiredMetadataSelectors(): SiteSelectors['metadata'] {
    const selectors = this.manifest.selectors.metadata;
    if (!selectors) {
      throw this.unsupportedCapability('metadata', 'metadata selectors');
    }
    return selectors;
  }

  private requiredChapterSelectors(): SiteSelectors['chapters'] {
    const selectors = this.manifest.selectors.chapters;
    if (!selectors) {
      throw this.unsupportedCapability('metadata', 'chapter list selectors');
    }
    return selectors;
  }

  private unsupportedCapability(capability: keyof AdapterCapabilities, method: string): ComicError {
    return new ComicError(
      `Adapter "${this.adapter.id}" does not support ${method}().`,
      ErrorType.ADAPTER_ERROR,
      false,
      { adapterId: this.adapter.id, capability }
    );
  }
}

class DynamicChapterImagesCapability extends ChapterImagesCapability {
  constructor(
    adapter: DynamicSiteAdapter,
    private readonly manifest: DynamicSiteAdapterManifest
  ) {
    super(adapter);
  }

  extractChapterImageUrls(document: unknown, chapterUrl: string): string[] {
    if (!this.adapter.capabilities.chapterImages) {
      throw this.unsupportedCapability('chapterImages', 'extractChapterImageUrls');
    }
    const $ = this.adapter.asCheerio(document);
    const selectors = this.manifest.selectors.images;
    const root = selectors.container ? $(selectors.container) : $.root();
    return root
      .find(selectors.item)
      .map((index, element) => {
        const value = $(element).attr(selectors.srcAttr) ?? $(element).attr('src') ?? '';
        return value ? this.adapter.resolveUrl(chapterUrl, value) : null;
      })
      .get()
      .filter((url): url is string => !!url);
  }

  private unsupportedCapability(capability: keyof AdapterCapabilities, method: string): ComicError {
    return new ComicError(
      `Adapter "${this.adapter.id}" does not support ${method}().`,
      ErrorType.ADAPTER_ERROR,
      false,
      { adapterId: this.adapter.id, capability }
    );
  }
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
