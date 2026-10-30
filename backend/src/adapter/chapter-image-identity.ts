import { createHash } from 'node:crypto';
import type {
  ChapterImageDescriptor,
  ChapterImageIdentityStrategyContract,
  ChapterImagesResponse,
  ChapterIdentityDescriptor,
  IComicAdapter,
} from '@comiccrawler/shared';

const VOLATILE_QUERY_PARAMETER = /^(?:token|auth|authorization|signature|sig|expires?|expiry|timestamp|ts|cache|cachebust|cb|policy|key-pair-id|x-amz-.+|x-goog-.+)$/i;

export class NormalizedUrlChapterImageIdentityStrategy implements ChapterImageIdentityStrategyContract {
  identifyChapter(input: { chapterUrl: string; document: unknown }): { canonicalUrl: string; sourceKey: string } {
    const canonicalUrl = normalizedChapterLookupKey(input.chapterUrl);
    return { canonicalUrl, sourceKey: canonicalUrl };
  }

  identifyPage(input: { chapterUrl: string; imageUrl: string; document: unknown }): { sourceKey: string } {
    return { sourceKey: normalizedPageMatchKey(input.chapterUrl, input.imageUrl) };
  }
}

export function normalizedChapterLookupKey(value: string): string {
  return normalizeHttpUrl(value, true);
}

export function normalizedPageMatchKey(chapterUrl: string, imageUrl: string): string {
  const parsed = new URL(imageUrl, chapterUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return normalizeHttpUrl(parsed.href, true);
  const search = stableSearch(parsed.searchParams);
  return `${parsed.pathname}${search}`;
}

export function createChapterImageIdentities(input: {
  adapter: IComicAdapter;
  chapterUrl: string;
  imageUrls: string[];
  document?: unknown;
}): Pick<ChapterImagesResponse, 'chapter' | 'images'> {
  const strategy: ChapterImageIdentityStrategyContract = input.adapter.chapterImageIdentity
    ?? new NormalizedUrlChapterImageIdentityStrategy();
  const chapter = createChapterIdentity(input, strategy);
  const duplicateOccurrences = new Map<string, number>();
  const images = input.imageUrls.map((url, index) => createPageIdentity(
    input, strategy, chapter, duplicateOccurrences, url, index
  ));
  return { chapter, images };
}

function createChapterIdentity(
  input: { adapter: IComicAdapter; chapterUrl: string; document?: unknown },
  strategy: ChapterImageIdentityStrategyContract
): ChapterIdentityDescriptor {
  const source = strategy.identifyChapter({ chapterUrl: input.chapterUrl, document: input.document });
  assertAbsoluteUrl(source.canonicalUrl, `Adapter "${input.adapter.id}" returned an invalid canonical chapter URL.`);
  if (!source.sourceKey.trim()) throw new Error(`Adapter "${input.adapter.id}" returned an empty chapter source key.`);
  return {
    id: opaqueId('chapter', input.adapter.id, source.sourceKey),
    canonicalUrl: source.canonicalUrl,
    stability: 'deterministic',
    identitySource: input.adapter.chapterImageIdentity ? 'adapter' : 'normalized-url',
  };
}

function createPageIdentity(
  input: { adapter: IComicAdapter; document?: unknown }, strategy: ChapterImageIdentityStrategyContract,
  chapter: ChapterIdentityDescriptor, occurrences: Map<string, number>, url: string, orderIndex: number
): ChapterImageDescriptor {
  const source = strategy.identifyPage({ chapterUrl: chapter.canonicalUrl, imageUrl: url, document: input.document });
  validatePageSource(input.adapter.id, source.sourceKey, source.sourceFingerprint);
  const occurrence = occurrences.get(source.sourceKey) ?? 0;
  occurrences.set(source.sourceKey, occurrence + 1);
  return {
    id: opaqueId('page', chapter.id, source.sourceKey, String(occurrence)), orderIndex, url,
    ...(source.sourceFingerprint ? { sourceFingerprint: source.sourceFingerprint } : {}),
  };
}

function validatePageSource(adapterId: string, sourceKey: string, fingerprint?: string): void {
  if (!sourceKey.trim()) throw new Error(`Adapter "${adapterId}" returned an empty chapter image source key.`);
  if (fingerprint && !/^(?:sha256|etag|opaque):.+/i.test(fingerprint)) {
    throw new Error(`Adapter "${adapterId}" returned a source fingerprint without a supported semantic prefix.`);
  }
}

function opaqueId(prefix: 'chapter' | 'page', ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('base64url')
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeHttpUrl(value: string, includeOrigin: boolean): string {
  const parsed = new URL(value);
  parsed.hash = '';
  const search = stableSearch(parsed.searchParams);
  parsed.search = search;
  if (includeOrigin || parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return parsed.href;
  return `${parsed.pathname}${search}`;
}

function stableSearch(parameters: URLSearchParams): string {
  const retained = new URLSearchParams();
  for (const [name, value] of parameters) {
    if (!VOLATILE_QUERY_PARAMETER.test(name)) retained.append(name, value);
  }
  retained.sort();
  const serialized = retained.toString();
  return serialized ? `?${serialized}` : '';
}

function assertAbsoluteUrl(value: string, message: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(message);
  }
}
