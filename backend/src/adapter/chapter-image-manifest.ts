import { createHash } from 'node:crypto';
import type { ChapterImageManifest, ChapterImagePageResolution,
  ChapterImagesResponse } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import { normalizedChapterLookupKey, normalizedPageMatchKey } from './chapter-image-identity';

const STORE_PREFIX = 'chapter-image-manifests/records';
const RESOLVER = { id: 'normalized-url', version: 1 } as const;

interface StoredPageMatch {
  pageId: string;
  orderIndex: number;
  matchKey: string;
  occurrence: number;
  sourceFingerprint?: string;
}

interface StoredChapterImageManifest {
  schemaVersion: 1;
  ownerUserId: string;
  lookupUrls: string[];
  resolver: typeof RESOLVER;
  manifest: ChapterImageManifest;
  pageMatches: StoredPageMatch[];
}

export class ChapterImageManifestConflictError extends Error {}
export class ChapterImageManifestRevisionError extends Error {}

export class ChapterImageManifestService {
  constructor(private readonly storage: IStorage, private readonly now: () => Date = () => new Date()) {}

  async save(ownerUserId: string, response: ChapterImagesResponse): Promise<ChapterImageManifest> {
    const manifest = createManifest(response, this.now().toISOString());
    const record = createStoredManifest(ownerUserId, response, manifest);
    await this.storage.write(storageKey(ownerUserId, manifest.chapter.id), record);
    return structuredClone(manifest);
  }

  async get(ownerUserId: string, chapterId: string): Promise<ChapterImageManifest | undefined> {
    const record = await this.readRecord(storageKey(ownerUserId, chapterId));
    if (!record || record.ownerUserId !== ownerUserId || record.manifest.chapter.id !== chapterId) return undefined;
    return structuredClone(record.manifest);
  }

  async resolve(
    ownerUserId: string, chapterUrl: string, adapterId?: string
  ): Promise<ChapterImageManifest | undefined> {
    const lookupKey = normalizedChapterLookupKey(chapterUrl);
    const records = await this.readOwnerRecords(ownerUserId);
    const matches = records.filter((record) => record.lookupUrls.includes(lookupKey)
      && (!adapterId || record.manifest.adapterId === adapterId));
    if (matches.length > 1) throw new ChapterImageManifestConflictError(adapterId
      ? 'Multiple chapter image manifests match this URL and adapter; read one by chapterId.'
      : 'Multiple chapter image manifests match this URL; specify adapterId.');
    return matches[0] ? structuredClone(matches[0].manifest) : undefined;
  }

  async resolvePages(
    ownerUserId: string, chapterId: string, urls: string[], revision?: string
  ): Promise<{ manifest: ChapterImageManifest; matches: ChapterImagePageResolution[] } | undefined> {
    const record = await this.readRecord(storageKey(ownerUserId, chapterId));
    if (!record || record.ownerUserId !== ownerUserId || record.manifest.chapter.id !== chapterId) return undefined;
    if (revision && revision !== record.manifest.revision)
      throw new ChapterImageManifestRevisionError('Chapter image manifest revision does not match.');
    const matches = resolvePageMatches(record, urls);
    return { manifest: structuredClone(record.manifest), matches };
  }

  private async readOwnerRecords(ownerUserId: string): Promise<StoredChapterImageManifest[]> {
    const prefix = `${STORE_PREFIX}/${digest(ownerUserId)}/`;
    const keys = (await this.storage.list()).filter((key) => key.startsWith(prefix));
    const records = await Promise.all(keys.map((key) => this.readRecord(key)));
    return records.filter((record): record is StoredChapterImageManifest => record?.ownerUserId === ownerUserId);
  }

  private async readRecord(key: string): Promise<StoredChapterImageManifest | undefined> {
    const value = await this.storage.read<StoredChapterImageManifest>(key);
    return isStoredManifest(value) ? value : undefined;
  }
}

function createManifest(response: ChapterImagesResponse, capturedAt: string): ChapterImageManifest {
  const semantic = { adapterId: response.adapterId, chapter: response.chapter,
    identityResolver: RESOLVER, images: response.images };
  return { ...semantic, revision: `sha256:${digest(JSON.stringify(semantic))}`,
    capturedAt: new Date(capturedAt).toISOString() };
}

function createStoredManifest(
  ownerUserId: string, response: ChapterImagesResponse, manifest: ChapterImageManifest
): StoredChapterImageManifest {
  const lookupUrls = [...new Set([response.chapterUrl, manifest.chapter.canonicalUrl]
    .map(normalizedChapterLookupKey))];
  return { schemaVersion: 1, ownerUserId, lookupUrls, resolver: RESOLVER, manifest,
    pageMatches: createPageMatches(manifest) };
}

function createPageMatches(manifest: ChapterImageManifest): StoredPageMatch[] {
  const occurrences = new Map<string, number>();
  return manifest.images.map((image) => {
    const matchKey = normalizedPageMatchKey(manifest.chapter.canonicalUrl, image.url);
    const occurrence = occurrences.get(matchKey) ?? 0;
    occurrences.set(matchKey, occurrence + 1);
    return { pageId: image.id, orderIndex: image.orderIndex, matchKey, occurrence,
      ...(image.sourceFingerprint ? { sourceFingerprint: image.sourceFingerprint } : {}) };
  });
}

function resolvePageMatches(
  record: StoredChapterImageManifest, urls: string[]
): ChapterImagePageResolution[] {
  const buckets = pageMatchBuckets(record.pageMatches);
  const keys = urls.map((url) => normalizedPageMatchKey(record.manifest.chapter.canonicalUrl, url));
  const counts = valueCounts(keys), consumed = new Map<string, number>();
  return urls.map((url, index) => resolvePage(url, keys[index]!, buckets, counts, consumed));
}

function resolvePage(
  url: string, key: string, buckets: Map<string, StoredPageMatch[]>,
  counts: Map<string, number>, consumed: Map<string, number>
): ChapterImagePageResolution {
  const candidates = buckets.get(key) ?? [];
  if (candidates.length === 0) return { url, status: 'not_found' };
  if (candidates.length > 1 && (counts.get(key) ?? 0) < candidates.length) return { url, status: 'ambiguous' };
  const occurrence = consumed.get(key) ?? 0; consumed.set(key, occurrence + 1);
  const page = candidates[occurrence];
  return page ? matchedPage(url, page) : { url, status: 'not_found' };
}

function matchedPage(url: string, page: StoredPageMatch): ChapterImagePageResolution {
  return { url, status: 'matched', pageId: page.pageId, orderIndex: page.orderIndex,
    ...(page.sourceFingerprint ? { sourceFingerprint: page.sourceFingerprint } : {}) };
}

function pageMatchBuckets(pages: StoredPageMatch[]): Map<string, StoredPageMatch[]> {
  const buckets = new Map<string, StoredPageMatch[]>();
  for (const page of pages) {
    const values = buckets.get(page.matchKey) ?? [];
    values.push(page); buckets.set(page.matchKey, values);
  }
  return buckets;
}

function valueCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function storageKey(ownerUserId: string, chapterId: string): string {
  return `${STORE_PREFIX}/${digest(ownerUserId)}/${digest(chapterId)}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isStoredManifest(value: unknown): value is StoredChapterImageManifest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredChapterImageManifest>;
  return record.schemaVersion === 1 && typeof record.ownerUserId === 'string'
    && Array.isArray(record.lookupUrls) && record.resolver?.id === RESOLVER.id
    && record.resolver.version === RESOLVER.version && Boolean(record.manifest)
    && Array.isArray(record.pageMatches);
}
