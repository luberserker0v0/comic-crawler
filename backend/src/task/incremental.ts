import type { ComicMetadata, ComicUpdate } from '@comiccrawler/shared';
import type { IComicAdapter } from '@comiccrawler/shared';
import type { IStorage } from '../storage/types';
import type { TaskManager } from './manager';

export interface IncrementalUpdateOptions {
  checkInterval?: number;
  autoDownload?: boolean;
}

export interface LocalComicRecord {
  id: string;
  title: string;
  adapterId: string;
  url: string;
  lastChecked: Date;
  chapters: Array<{ id: string; title: string; url: string }>;
}

export class IncrementalUpdater {
  private storage: IStorage;
  private taskManager: TaskManager;
  private options: Required<IncrementalUpdateOptions>;

  constructor(storage: IStorage, taskManager: TaskManager, options?: IncrementalUpdateOptions) {
    this.storage = storage;
    this.taskManager = taskManager;
    this.options = {
      checkInterval: options?.checkInterval ?? 3600000,
      autoDownload: options?.autoDownload ?? false,
    };
  }

  async checkForUpdates(adapter: IComicAdapter, url: string): Promise<ComicUpdate[]> {
    const localRecord = await this.getLocalRecord(url);
    if (!localRecord) return [];

    const metadata = await composeMetadataForRuntime(adapter, url);
    const updates = this.findNewChapters(localRecord, metadata);

    if (updates.length > 0) {
      localRecord.lastChecked = new Date();
      localRecord.chapters = metadata.chapters;
      await this.saveLocalRecord(localRecord);
    }

    return updates;
  }

  async checkAllRegistered(): Promise<Record<string, ComicUpdate[]>> {
    const records = await this.getAllLocalRecords();
    const results: Record<string, ComicUpdate[]> = {};

    for (const record of records) {
      try {
        const adapterId = record.adapterId;
        const updates = await this.checkForUpdates({
          id: adapterId,
          name: '',
          domains: [],
          parseMode: 'static',
          capabilities: { verification: false, metadata: true, chapterImages: false },
          matchUrl: () => true,
          loadDocument: async () => ({}),
          extractTitle: () => record.title,
          extractChapterList: () => record.chapters,
        } as unknown as IComicAdapter, record.url);
        results[record.id] = updates;
      } catch {
        results[record.id] = [];
      }
    }

    return results;
  }

  async registerComic(record: LocalComicRecord): Promise<void> {
    const records = await this.getAllLocalRecords();
    const existing = records.findIndex((r) => r.url === record.url);

    if (existing !== -1) {
      records[existing] = record;
    } else {
      records.push(record);
    }

    await this.saveAllLocalRecords(records);
  }

  async unregisterComic(url: string): Promise<void> {
    const records = await this.getAllLocalRecords();
    const filtered = records.filter((r) => r.url !== url);
    await this.saveAllLocalRecords(filtered);
  }

  private async getLocalRecord(url: string): Promise<LocalComicRecord | undefined> {
    const records = await this.getAllLocalRecords();
    return records.find((r) => r.url === url);
  }

  private async getAllLocalRecords(): Promise<LocalComicRecord[]> {
    return (await this.storage.read<LocalComicRecord[]>('local_comics')) ?? [];
  }

  private async saveLocalRecord(record: LocalComicRecord): Promise<void> {
    const records = await this.getAllLocalRecords();
    const index = records.findIndex((r) => r.url === record.url);

    if (index !== -1) {
      records[index] = record;
    } else {
      records.push(record);
    }

    await this.storage.write('local_comics', records);
  }

  private async saveAllLocalRecords(records: LocalComicRecord[]): Promise<void> {
    await this.storage.write('local_comics', records);
  }

  private findNewChapters(local: LocalComicRecord, remote: ComicMetadata): ComicUpdate[] {
    const localChapterIds = new Set(local.chapters.map((c) => c.id));
    const newChapters = remote.chapters.filter((c) => !localChapterIds.has(c.id));

    return newChapters.map((chapter) => ({
      comicId: local.id,
      type: 'new_chapter' as const,
      chapterId: chapter.id,
    }));
  }
}

async function composeMetadataForRuntime(adapter: IComicAdapter, url: string): Promise<ComicMetadata> {
  const runtime = adapter as unknown as { loadDocument?: (url: string) => Promise<unknown> };
  if (!runtime.loadDocument || !adapter.extractTitle || !adapter.extractChapterList) {
    throw new Error(`Adapter "${adapter.id}" does not expose metadata extraction methods.`);
  }
  const document = await runtime.loadDocument(url);
  return {
    id: new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? adapter.id,
    title: await adapter.extractTitle(document, url),
    author: await adapter.extractAuthor?.(document, url),
    coverUrl: await adapter.extractCoverUrl?.(document, url),
    status: await adapter.extractStatus?.(document, url) ?? 'unknown',
    tags: await adapter.extractTags?.(document, url) ?? [],
    description: await adapter.extractDescription?.(document, url),
    chapters: await adapter.extractChapterList(document, url),
  };
}
