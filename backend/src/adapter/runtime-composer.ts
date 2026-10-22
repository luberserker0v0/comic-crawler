import type { ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import { ComicError, ErrorType } from '../error/types';
import type { AdapterBase } from './base';

export async function composeMetadata(adapter: AdapterBase, url: string): Promise<ComicMetadata> {
  assertCapability(adapter, 'metadata');
  const { document, title, chapters } = await loadRequiredMetadata(adapter, url);
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

async function loadRequiredMetadata(adapter: AdapterBase, url: string) {
  const document = await adapter.loadDocument(url);
  const title = await adapter.extractTitle(document, url);
  const chapters = await adapter.extractChapterList(document, url);
  if (title && chapters.length > 0) return { document, title, chapters };
  throw new ComicError(
    `Adapter "${adapter.id}" did not extract required metadata fields.`,
    ErrorType.PARSING_ERROR, false,
    { adapterId: adapter.id, url, missing: { title: !title, chapters: chapters.length === 0 } }
  );
}

export async function composeChapterImages(adapter: AdapterBase, chapterUrl: string): Promise<ImageInfo[]> {
  assertCapability(adapter, 'chapterImages');
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

function assertCapability(adapter: AdapterBase, capability: 'metadata' | 'chapterImages'): void {
  if (adapter.capabilities[capability]) return;
  throw new ComicError(
    `Adapter "${adapter.id}" does not support ${capability} capability.`,
    ErrorType.ADAPTER_ERROR, false, { adapterId: adapter.id, capability }
  );
}

function deriveMetadataId(adapter: AdapterBase, url: string): string {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.at(-1) ?? adapter.id;
}

function imageExtensionFor(url: string): string {
  return /\.(jpg|jpeg|png|webp|gif|avif)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg';
}
