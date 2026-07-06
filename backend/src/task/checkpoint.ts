import type { ComicMetadata, ImageInfo } from '@comiccrawler/shared';

export interface ChapterCheckpoint {
  id: string;
  title: string;
  url: string;
  images?: ImageInfo[];
  completedImageIndexes: number[];
  failedImageIndexes: number[];
  completed: boolean;
  lastError?: string;
}

export interface CrawlCheckpoint {
  taskId: string;
  currentChapterId?: string;
  currentChapterTitle?: string;
  metadata?: ComicMetadata;
  outputPath?: string;
  totalImages: number;
  completedImages: number;
  failedImages: number;
  chapters: Record<string, ChapterCheckpoint>;
  resumable: boolean;
  updatedAt: string;
  lastError?: string;
}

export interface CrawlCheckpointSummary {
  currentChapter?: string;
  completedImages: number;
  failedImages: number;
  resumable: boolean;
  updatedAt?: string;
}

export function createEmptyCheckpoint(taskId: string): CrawlCheckpoint {
  return {
    taskId,
    totalImages: 0,
    completedImages: 0,
    failedImages: 0,
    chapters: {},
    resumable: false,
    updatedAt: new Date().toISOString(),
  };
}

export function summarizeCheckpoint(checkpoint?: CrawlCheckpoint): CrawlCheckpointSummary | null {
  if (!checkpoint) return null;
  return {
    currentChapter: checkpoint.currentChapterTitle,
    completedImages: checkpoint.completedImages,
    failedImages: checkpoint.failedImages,
    resumable: checkpoint.resumable,
    updatedAt: checkpoint.updatedAt,
  };
}
