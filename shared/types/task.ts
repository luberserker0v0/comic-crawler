export type TaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting_for_browser_worker'
  | 'waiting_verification'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskProgress {
  totalChapters: number;
  completedChapters: number;
  totalImages: number;
  completedImages: number;
  stage?: CrawlStage;
  stageDetail?: string;
  currentChapter?: string;
  currentImage?: number;
  failedImages: number;
  skippedImages: number;
  metadata?: Record<string, unknown>;
  chapterListSummary?: ChapterListSummary;
}

export type CrawlStage =
  | 'adapter'
  | 'verification'
  | 'metadata'
  | 'chapter_list'
  | 'chapter_images'
  | 'downloading'
  | 'completed'
  | 'failed';

export interface ChapterListSummary {
  totalChapters: number;
  chapters: Array<Pick<ChapterInfo, 'id' | 'title' | 'url'>>;
}

export interface ChapterInfo {
  id: string;
  title: string;
  url: string;
  status?: TaskStatus;
  totalImages?: number;
  completedImages?: number;
  number?: number;
  date?: Date;
}

export type ImageFormat = 'original' | 'jpg' | 'png' | 'webp';
