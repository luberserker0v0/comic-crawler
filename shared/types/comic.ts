import type { ChapterInfo } from './task';

export type ComicStatus = 'ongoing' | 'completed' | 'unknown';

export interface ComicMetadata {
  id: string;
  title: string;
  author?: string;
  coverUrl?: string;
  chapters: ChapterInfo[];
  description?: string;
  tags?: string[];
  status?: ComicStatus;
  updatedAt?: Date;
  rating?: number;
}

export interface ImageInfo {
  url: string;
  index: number;
  filename?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  coverUrl?: string;
  author?: string;
  tags?: string[];
  status?: ComicStatus;
  rating?: number;
}

export interface SearchOptions {
  page?: number;
  limit?: number;
  tags?: string[];
  status?: ComicStatus;
}

export interface Credentials {
  username?: string;
  password?: string;
  cookie?: string;
  [key: string]: string | undefined;
}
