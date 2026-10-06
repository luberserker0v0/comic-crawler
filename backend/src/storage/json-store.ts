import { promises as fs } from 'node:fs';
import { extname, resolve, relative } from 'node:path';
import type { IStorage, WriteOperation, JsonFileStoreOptions } from './types';

export class JsonFileStore implements IStorage {
  private basePath: string;
  private flushInterval: number;
  private maxBufferSize: number;
  private writeQueue: WriteOperation[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private flushChain: Promise<void> = Promise.resolve();
  private disposed = false;

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
    // Retry the whole read+parse: a concurrent flush can tear the content
    // (direct writeFile truncates first), so a single attempt may observe
    // empty or half-written JSON. Transients heal within milliseconds; only
    // a persistently unreadable file falls through to null below.
    let lastContent: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      let content: string;
      try {
        content = await this.readFileWithRetry(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
      }
      try {
        return JSON.parse(content) as T;
      } catch {
        lastContent = content;
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
      }
    }
    // Preserve the legacy null contract (all callers null-coalesce), but log:
    // permanently corrupt data used to be indistinguishable from "no data".
    console.error(
      `[JsonFileStore] persistent parse failure for key "${key}" ` +
        `(returning null, content head: ${JSON.stringify((lastContent ?? '').slice(0, 120))})`
    );
    return null;
  }

  private async readFileWithRetry(filePath: string, attempts = 5): Promise<string> {
    // On Windows a concurrent write can make a read fail with
    // EPERM/EBUSY/EACCES. The write lands within milliseconds, so a short
    // ride-through beats surfacing a transient error to callers.
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT' || code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' || attempt === attempts - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  async write(key: string, value: unknown): Promise<void> {
    if (this.disposed) {
      // No timer will fire after dispose; persist synchronously.
      const filePath = this.resolvePath(key);
      const content = JSON.stringify(value, null, 2);
      await this.atomicWriteFile(filePath, content);
      return;
    }
    return new Promise<void>((resolve, reject) => {
      this.writeQueue.push({ key, value, resolve, reject });

      if (this.writeQueue.length >= this.maxBufferSize) {
        void this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
      }
    });
  }

  async delete(key: string): Promise<void> {
    // Drop not-yet-flushed writes for this key so a deleted file
    // cannot reappear when the queue drains.
    const pending = this.writeQueue.filter((op) => op.key === key);
    this.writeQueue = this.writeQueue.filter((op) => op.key !== key);
    pending.forEach((op) => op.resolve());
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

  async stat(key: string): Promise<{ mtimeMs: number } | null> {
    const filePath = this.resolvePath(key);
    try {
      const stats = await fs.stat(filePath);
      return { mtimeMs: stats.mtimeMs };
    } catch {
      return null;
    }
  }

  private resolvePath(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('JsonFileStore: key must be a non-empty string');
    }
    // Flat mapping (kept for backward compat): 'tasks/index' -> 'tasks_index.json'.
    // '/' and '\' are sanitized so keys can never escape basePath.
    const safeKey = key.replace(/[<>:"/\\|?*]/g, '_');
    if (safeKey === '.' || safeKey === '..') {
      throw new Error(`JsonFileStore: invalid key "${key}"`);
    }
    const filePath = resolve(this.basePath, `${safeKey}.json`);
    const rel = relative(resolve(this.basePath), filePath);
    if (rel.startsWith('..') || resolve(this.basePath, rel) !== filePath) {
      throw new Error(`JsonFileStore: key escapes basePath: "${key}"`);
    }
    return filePath;
  }

  private scheduleFlush(): Promise<void> {
    // Concurrent flush() calls share one chain so a second flush request
    // while a flush is in flight is not lost.
    this.flushChain = this.flushChain.then(() => this.flushOnce());
    return this.flushChain;
  }

  private async flush(): Promise<void> {
    await this.scheduleFlush();
  }

  private async flushOnce(): Promise<void> {
    if (this.isFlushing || this.writeQueue.length === 0) return;

    this.isFlushing = true;
    // Drain in queue order, grouped by key: writes to the SAME key are
    // applied sequentially so rapid successive persists (e.g. task:started
    // immediately followed by task:progress + task:completed) cannot lose
    // intermediate updates to a same-file race; DIFFERENT keys still flush
    // concurrently to preserve the original timing characteristics.
    const operations = this.writeQueue.splice(0, this.writeQueue.length);
    const byKey = new Map<string, WriteOperation[]>();
    for (const op of operations) {
      const bucket = byKey.get(op.key);
      if (bucket) bucket.push(op);
      else byKey.set(op.key, [op]);
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      const writes = [...byKey.values()].map(async (bucket) => {
        for (const op of bucket) {
          const filePath = this.resolvePath(op.key);
          const content = JSON.stringify(op.value, null, 2);
          await this.atomicWriteFile(filePath, content);
          op.resolve();
        }
      });

      await Promise.all(writes);
    } catch (error) {
      // A failed flush rejects every write in the batch. Callers are often
      // fire-and-forget event handlers, so also log: silent loss here once
      // cost us a long flaky-suite debugging session (Windows EPERM).
      console.error(`[JsonFileStore] flush failed for ${operations.map((op) => op.key).join(',')}: ${(error as Error)?.message}`);
      operations.forEach((op) => op.reject(error as Error));
    } finally {
      this.isFlushing = false;

      if (this.writeQueue.length > 0) {
        await this.flushOnce();
      }
    }
  }

  private async atomicWriteFile(filePath: string, content: string): Promise<void> {
    // NOTE: intentionally a direct write, not tmp+rename. tmp+rename is the
    // textbook crash-safe approach, but on Windows rename fails with EPERM
    // while a concurrent reader holds the target open -- and this codebase
    // polls the store in tight loops (waitForPersistedRecord) plus reopens
    // the same basePath from a second store (restart simulation). The poll
    // readers themselves starve the rename: retries (~0.8s budget) outlast
    // the poll window, the write is lost (rejection swallowed by
    // fire-and-forget event handlers), and the suite goes 50/50 flaky.
    // Direct writes keep the original timing characteristics; torn reads on
    // crash now surface loudly via read() instead of silently becoming null.
    // Revisit with a real WAL/SQLite backend if crash atomicity is required.
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Drain: writes may have been queued while a flush was in flight.
    while (this.writeQueue.length > 0) {
      await this.flush();
    }
  }
}
