import type { ComicMetadata, ImageInfo, SearchResult, SearchOptions, ComicUpdate } from '@comiccrawler/shared';
import type { IExtractionStrategy, ExtractionContext } from '../types';

export class EmbeddedJsonStrategy implements IExtractionStrategy {
  readonly name = 'embedded-json';
  readonly parseMode = 'static' as const;

  private jsonSelector: string;

  constructor(jsonSelector = 'script[type="application/json"], script[data-json]') {
    this.jsonSelector = jsonSelector;
  }

  async extractMetadata(context: ExtractionContext): Promise<ComicMetadata> {
    const { $ } = context;
    if (!$) {
      throw new Error('Cheerio $ is required for embedded JSON extraction');
    }

    const jsonData = this.extractJson($);
    if (!jsonData) {
      throw new Error('No embedded JSON data found');
    }

    return this.parseMetadata(jsonData, context.baseUrl);
  }

  async extractChapters(context: ExtractionContext): Promise<Array<{ id: string; title: string; url: string }>> {
    const { $ } = context;
    if (!$) {
      throw new Error('Cheerio $ is required for embedded JSON extraction');
    }

    const jsonData = this.extractJson($);
    if (!jsonData) return [];

    return this.parseChapters(jsonData, context.baseUrl);
  }

  async extractImages(context: ExtractionContext): Promise<ImageInfo[]> {
    const { $ } = context;
    if (!$) {
      throw new Error('Cheerio $ is required for embedded JSON extraction');
    }

    const jsonData = this.extractJson($);
    if (!jsonData) return [];

    return this.parseImages(jsonData, context.baseUrl);
  }

  async search?(_query: string, _options: SearchOptions, _context: ExtractionContext): Promise<SearchResult[]> {
    return [];
  }

  async fetchUpdates?(_since: Date, _context: ExtractionContext): Promise<ComicUpdate[]> {
    return [];
  }

  async validate(context: ExtractionContext): Promise<boolean> {
    const { $ } = context;
    if (!$) return false;

    return $(this.jsonSelector).length > 0;
  }

  private extractJson($: cheerio.CheerioAPI): Record<string, unknown> | null {
    const scriptContent = $(this.jsonSelector).first().html();
    if (!scriptContent) return null;

    try {
      const jsonMatch = scriptContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private parseMetadata(data: Record<string, unknown>, baseUrl: string): ComicMetadata {
    return {
      id: String(data.id ?? ''),
      title: String(data.title ?? ''),
      author: data.author ? String(data.author) : undefined,
      coverUrl: data.coverUrl ? this.resolveUrl(String(data.coverUrl), baseUrl) : undefined,
      chapters: [],
      tags: Array.isArray(data.tags) ? data.tags.map(String) : undefined,
      status: (data.status as any) ?? 'unknown',
    };
  }

  private parseChapters(data: Record<string, unknown>, baseUrl: string): Array<{ id: string; title: string; url: string }> {
    const chapters = data.chapters as Array<{ id: string; title: string; url: string }> | undefined;
    if (!Array.isArray(chapters)) return [];

    return chapters.map((ch) => ({
      ...ch,
      url: this.resolveUrl(ch.url, baseUrl),
    }));
  }

  private parseImages(data: Record<string, unknown>, baseUrl: string): ImageInfo[] {
    const images = data.images as Array<{ url: string; index: number }> | undefined;
    if (!Array.isArray(images)) return [];

    return images.map((img) => ({
      url: this.resolveUrl(img.url, baseUrl),
      index: img.index,
    }));
  }

  private resolveUrl(url: string, baseUrl: string): string {
    if (!url) return '';
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  }
}

import * as cheerio from 'cheerio';
