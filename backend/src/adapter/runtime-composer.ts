import type { ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import { ComicError, ErrorType } from '../error/types';
import type { AdapterBase } from './base';

export async function composeMetadata(adapter: AdapterBase, url: string): Promise<ComicMetadata> {
  if (!adapter.capabilities.metadata) {
    throw new ComicError(
      `Adapter "${adapter.id}" does not support metadata capability.`,
      ErrorType.ADAPTER_ERROR,
      false,
      { adapterId: adapter.id, capability: 'metadata' }
    );
  }

  const document = await adapter.loadDocument(url);
  const title = await adapter.extractTitle(document, url);
  const chapters = await adapter.extractChapterList(document, url);
  if (!title || chapters.length === 0) {
    throw new ComicError(
      `Adapter "${adapter.id}" did not extract required metadata fields.`,
      ErrorType.PARSING_ERROR,
      false,
      { adapterId: adapter.id, url, missing: { title: !title, chapters: chapters.length === 0 } }
    );
  }

  return {
    id: deriveMetadataId(adapter, url),
    title,
    author: await adapter.extractAuthor(document, url),
    coverUrl: await adapter.extractCoverUrl(document, url),
    status: await adapter.extractStatus(document, url) ?? 'unknown',
    tags: await adapter.extractTags(document, url),
    description: await adapter.extractDescription(document, url),
    chapters,
  };
}

export async function composeChapterImages(adapter: AdapterBase, chapterUrl: string): Promise<ImageInfo[]> {
  if (!adapter.capabilities.chapterImages) {
    throw new ComicError(
      `Adapter "${adapter.id}" does not support chapterImages capability.`,
      ErrorType.ADAPTER_ERROR,
      false,
      { adapterId: adapter.id, capability: 'chapterImages' }
    );
  }

  const document = await adapter.loadDocument(chapterUrl);
  const urls = await adapter.extractChapterImageUrls(document, chapterUrl);
  if (urls.length === 0) {
    throw new ComicError(
      `Adapter "${adapter.id}" did not extract any chapter image URLs.`,
      ErrorType.PARSING_ERROR,
      false,
      { adapterId: adapter.id, url: chapterUrl }
    );
  }

  return urls.map((url, index) => ({
    url,
    index,
    filename: `${String(index + 1).padStart(3, '0')}.${imageExtensionFor(url)}`,
  }));
}

function deriveMetadataId(adapter: AdapterBase, url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? adapter.id;
}

function imageExtensionFor(url: string): string {
  return /\.(jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
}
