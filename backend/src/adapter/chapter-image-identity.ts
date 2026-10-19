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
    const canonicalUrl = normalizeHttpUrl(input.chapterUrl, true);
    return { canonicalUrl, sourceKey: canonicalUrl };
  }

  identifyPage(input: { chapterUrl: string; imageUrl: string; document: unknown }): { sourceKey: string } {
    const parsed = new URL(input.imageUrl, input.chapterUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { sourceKey: normalizeHttpUrl(parsed.href, true) };
    }

    // Page identity deliberately excludes the origin. CDN host rotation should
    // not change a logical source page; the chapter ID supplies the namespace.
    const search = stableSearch(parsed.searchParams);
    return { sourceKey: `${parsed.pathname}${search}` };
  }
}

export function createChapterImageIdentities(input: {
  adapter: IComicAdapter;
  chapterUrl: string;
  imageUrls: string[];
  document?: unknown;
}): Pick<ChapterImagesResponse, 'chapter' | 'images'> {
  const strategy: ChapterImageIdentityStrategyContract = input.adapter.chapterImageIdentity
    ?? new NormalizedUrlChapterImageIdentityStrategy();
  const chapterSource = strategy.identifyChapter({
    chapterUrl: input.chapterUrl,
    document: input.document,
  });
  const canonicalUrl = chapterSource.canonicalUrl;
  assertAbsoluteUrl(canonicalUrl, `Adapter "${input.adapter.id}" returned an invalid canonical chapter URL.`);
  if (!chapterSource.sourceKey.trim()) {
    throw new Error(`Adapter "${input.adapter.id}" returned an empty chapter source key.`);
  }
  const chapterId = opaqueId('chapter', input.adapter.id, chapterSource.sourceKey);
  const chapter: ChapterIdentityDescriptor = {
    id: chapterId,
    canonicalUrl,
    stability: 'deterministic',
    identitySource: input.adapter.chapterImageIdentity ? 'adapter' : 'normalized-url',
  };
  const duplicateOccurrences = new Map<string, number>();
  const images: ChapterImageDescriptor[] = input.imageUrls.map((url, orderIndex) => {
    const source = strategy.identifyPage({ chapterUrl: canonicalUrl, imageUrl: url, document: input.document });
    if (!source.sourceKey.trim()) {
      throw new Error(`Adapter "${input.adapter.id}" returned an empty chapter image source key.`);
    }
    if (source.sourceFingerprint && !/^(?:sha256|etag|opaque):.+/i.test(source.sourceFingerprint)) {
      throw new Error(
        `Adapter "${input.adapter.id}" returned a source fingerprint without a supported semantic prefix.`
      );
    }
    const occurrence = duplicateOccurrences.get(source.sourceKey) ?? 0;
    duplicateOccurrences.set(source.sourceKey, occurrence + 1);
    return {
      id: opaqueId('page', chapterId, source.sourceKey, String(occurrence)),
      orderIndex,
      url,
      ...(source.sourceFingerprint ? { sourceFingerprint: source.sourceFingerprint } : {}),
    };
  });

  return { chapter, images };
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
