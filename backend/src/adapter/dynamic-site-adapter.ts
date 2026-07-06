import type { AdapterCapabilities, ComicMetadata, ImageInfo, SiteSelectors } from '@comiccrawler/shared';
import { BaseAdapter } from './base';
import { ComicError, ErrorType } from '../error/types';

type DynamicSiteSelectors = Partial<SiteSelectors> & {
  images: SiteSelectors['images'];
};

export interface DynamicSiteAdapterManifest {
  adapterId: string;
  name: string;
  domains: string[];
  urlPatterns: string[];
  capabilities?: AdapterCapabilities;
  selectors: DynamicSiteSelectors;
  sourceDiscoveryId: string;
  promotedAt: string;
}

export class DynamicSiteAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  readonly domains: string[];
  readonly parseMode = 'dynamic' as const;
  readonly capabilities: AdapterCapabilities;

  constructor(private readonly manifest: DynamicSiteAdapterManifest) {
    super();
    this.id = manifest.adapterId;
    this.name = manifest.name || manifest.adapterId;
    this.domains = manifest.domains;
    this.capabilities = manifest.capabilities ?? {
      verification: true,
      metadata: true,
      chapterImages: true,
    };
  }

  matchUrl(url: string): boolean {
    const parsed = new URL(url);
    if (!this.domains.includes(parsed.hostname)) return false;
    if (this.manifest.urlPatterns.length === 0) return true;
    return this.manifest.urlPatterns.some((pattern) => wildcardToRegex(pattern).test(url));
  }

  async fetchMetadata(url: string): Promise<ComicMetadata> {
    if (!this.capabilities.metadata) {
      throw new ComicError(
        `Adapter "${this.id}" does not support fetchMetadata().`,
        ErrorType.ADAPTER_ERROR,
        false,
        { adapterId: this.id, capability: 'metadata' }
      );
    }

    const html = await this.fetchHtml(url);
    const $ = this.parseHtml(html);
    const selectors = this.manifest.selectors;
    if (!selectors.metadata || !selectors.chapters) {
      throw new ComicError(
        `Adapter "${this.id}" is missing metadata/chapter selectors.`,
        ErrorType.ADAPTER_ERROR,
        false,
        { adapterId: this.id, capability: 'metadata' }
      );
    }
    const metadataSelectors = selectors.metadata;
    const chapterSelectors = selectors.chapters;

    const chapters = $(chapterSelectors.list)
      .find(chapterSelectors.item)
      .map((index, element) => {
        const item = $(element);
        const link = chapterSelectors.url ? item.find(chapterSelectors.url).addBack(chapterSelectors.url).first() : item;
        const titleNode = chapterSelectors.title ? item.find(chapterSelectors.title).addBack(chapterSelectors.title).first() : item;
        const href = link.attr('href') ?? '';
        return {
          id: href || String(index),
          title: titleNode.text().trim() || `Chapter ${index + 1}`,
          url: href ? this.resolveUrl(url, href) : url,
          index,
        };
      })
      .get();

    return {
      id: new URL(url).pathname,
      title: this.extractText($, metadataSelectors.title) || this.name,
      author: this.extractText($, metadataSelectors.author) || undefined,
      coverUrl: this.extractAttr($, metadataSelectors.cover, 'src') || this.extractAttr($, metadataSelectors.cover, 'content') || undefined,
      status: 'unknown',
      tags: this.extractAllText($, metadataSelectors.tags),
      description: metadataSelectors.description ? this.extractText($, metadataSelectors.description) : undefined,
      chapters,
    };
  }

  async fetchChapterImages(chapterUrl: string): Promise<ImageInfo[]> {
    if (!this.capabilities.chapterImages) {
      throw new ComicError(
        `Adapter "${this.id}" does not support fetchChapterImages().`,
        ErrorType.ADAPTER_ERROR,
        false,
        { adapterId: this.id, capability: 'chapterImages' }
      );
    }

    const html = await this.fetchHtml(chapterUrl);
    const $ = this.parseHtml(html);
    const selectors = this.manifest.selectors.images;
    const root = selectors.container ? $(selectors.container) : $.root();
    return root
      .find(selectors.item)
      .map((index, element) => {
        const value = $(element).attr(selectors.srcAttr) ?? $(element).attr('src') ?? '';
        return value ? { url: this.resolveUrl(chapterUrl, value), index } : null;
      })
      .get()
      .filter((image): image is ImageInfo => !!image);
  }
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
