import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import type { IStorage, WriteOperation, JsonFileStoreOptions } from './types';

export class JsonFileStore implements IStorage {
  private basePath: string;
  private flushInterval: number;
  private maxBufferSize: number;
  private writeQueue: WriteOperation[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(options: JsonFileStoreOptions) {
    this.basePath = options.basePath;
    this.flushInterval = options.flushInterval ?? 1000;
    this.maxBufferSize = options.maxBufferSize ?? 100;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async read<T>(key: string): Promise<T | null> {
    const filePath = this.resolvePath(key);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writeQueue.push({ key, value, resolve, reject });

      if (this.writeQueue.length >= this.maxBufferSize) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
      }
    });
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist, ignore
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.basePath);
      return files
        .filter((file) => extname(file) === '.json')
        .map((file) => file.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private resolvePath(key: string): string {
    const safeKey = key.replace(/[<>:"/\\|?*]/g, '_');
    return join(this.basePath, `${safeKey}.json`);
  }

  private async flush(): Promise<void> {
    if (this.isFlushing || this.writeQueue.length === 0) return;

    this.isFlushing = true;
    const operations = this.writeQueue.splice(0, this.writeQueue.length);

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      const writes = operations.map(async (op) => {
        const filePath = this.resolvePath(op.key);
        const content = JSON.stringify(op.value, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
        op.resolve();
      });

      await Promise.all(writes);
    } catch (error) {
      operations.forEach((op) => op.reject(error as Error));
    } finally {
      this.isFlushing = false;

      if (this.writeQueue.length > 0) {
        this.flush();
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
