import { promises as fs } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { ChapterListSummary, ComicMetadata, TaskPreviewFile } from '@comiccrawler/shared';
import { ComicError } from '../error/types';
import type { ChapterCheckpoint, CrawlCheckpoint } from '../task/checkpoint';

export function createChapterListSummary(metadata: ComicMetadata): ChapterListSummary {
  return {
    totalChapters: metadata.chapters.length,
    chapters: metadata.chapters.slice(0, 50).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      url: chapter.url,
    })),
  };
}

export async function createPreviewFile(taskId: string, rootDir: string, filePath: string): Promise<TaskPreviewFile | undefined> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return undefined;
    }
    const relativePath = relative(rootDir, filePath);
    const isImage = isPreviewImage(filePath);
    return {
      name: filePath.split(/[\\/]/).pop() ?? relativePath,
      relativePath,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      isImage,
      url: isImage ? `/api/tasks/${encodeURIComponent(taskId)}/preview-file?path=${encodeURIComponent(relativePath)}` : undefined,
    };
  } catch {
    return undefined;
  }
}

export function isPreviewImage(path: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].includes(extname(path).toLowerCase());
}

export function ensureChapterCheckpoint(checkpoint: CrawlCheckpoint, chapter: ComicMetadata['chapters'][number]): ChapterCheckpoint {
  const existing = checkpoint.chapters[chapter.id];
  if (existing) {
    return existing;
  }

  const created: ChapterCheckpoint = {
    id: chapter.id,
    title: chapter.title,
    url: chapter.url,
    completedImageIndexes: [],
    failedImageIndexes: [],
    completed: false,
  };
  checkpoint.chapters[chapter.id] = created;
  return created;
}

export function recountCheckpoint(
  checkpoint: CrawlCheckpoint,
  chapters: Array<ComicMetadata['chapters'][number]>
): { totalImages: number; completedImages: number; failedImages: number } {
  let totalImages = 0;
  let completedImages = 0;
  let failedImages = 0;

  for (const chapter of chapters) {
    const chapterCheckpoint = checkpoint.chapters[chapter.id];
    if (!chapterCheckpoint) {
      continue;
    }

    totalImages += chapterCheckpoint.images?.length ?? 0;
    completedImages += new Set(chapterCheckpoint.completedImageIndexes).size;
    const completedSet = new Set(chapterCheckpoint.completedImageIndexes);
    failedImages += new Set(chapterCheckpoint.failedImageIndexes.filter((index) => !completedSet.has(index))).size;
  }

  return { totalImages, completedImages, failedImages };
}

export function getOutputRoot(downloadDir: string, url: string, title: string): string {
  const hostname = safePathSegment(new URL(url).hostname.replace(/^www\./i, ''));
  return join(downloadDir, hostname, safePathSegment(title));
}

export function deriveComicTitle(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const mangaIndex = segments.indexOf('manga');
    const slug = mangaIndex >= 0 ? segments[mangaIndex + 1] : segments.at(-2) ?? segments.at(-1);
    return slug ?? 'Direct Chapters';
  } catch {
    return 'Direct Chapters';
  }
}

export function deriveChapterTitle(chapterUrl: string, index: number): string {
  try {
    const segment = new URL(chapterUrl).pathname.split('/').filter(Boolean).at(-1);
    return segment ?? `chapter-${index + 1}`;
  } catch {
    return `chapter-${index + 1}`;
  }
}

export function safeSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'chapter';
}

export function safePathSegment(value: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally strips control chars from path segments
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-').replace(/\s+/g, ' ').replace(/^-+|-+$/g, '') || 'unknown';
}

export function isHeadlessFallbackHttpStatus(statusCode: unknown): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 429 || statusCode === 503;
}

export function isHumanVerificationRequiredError(error: unknown): boolean {
  if (error instanceof ComicError) {
    return hasHumanVerificationContext(error.context);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access/i.test(message);
}

export function hasHumanVerificationContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (
    context.antiBotChallenge === true ||
    context.challengeType === 'access_blocked' ||
    context.humanVerificationProfileUnavailable === true
  ) return true;
  return Object.values(context).some((entry) => hasHumanVerificationContext(entry));
}

export function createDirectChapterMetadata(url: string, chapterUrls: string[]): ComicMetadata {
  const title = deriveComicTitle(url);

  return {
    id: safeSegment(title || 'direct-chapters'),
    title: title || 'Direct Chapters',
    status: 'unknown',
    chapters: chapterUrls.map((chapterUrl, index) => ({
      id: safeSegment(new URL(chapterUrl).pathname.split('/').filter(Boolean).at(-1) ?? `chapter-${index + 1}`),
      title: deriveChapterTitle(chapterUrl, index),
      url: chapterUrl,
    })),
    updatedAt: new Date(),
  };
}
