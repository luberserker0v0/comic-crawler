import { createHash } from 'node:crypto';

export interface DedupEntry {
  url: string;
  hash: string;
  path: string;
  timestamp: Date;
}

export interface DedupResult {
  isDuplicate: boolean;
  existingPath?: string;
}

export class DedupChecker {
  private urlIndex = new Map<string, string>();
  private hashIndex = new Map<string, string>();
  private entries: DedupEntry[] = [];

  async check(url: string, buffer?: Buffer): Promise<DedupResult> {
    if (this.urlIndex.has(url)) {
      return {
        isDuplicate: true,
        existingPath: this.urlIndex.get(url),
      };
    }

    if (buffer) {
      const hash = this.computeHash(buffer);
      if (this.hashIndex.has(hash)) {
        return {
          isDuplicate: true,
          existingPath: this.hashIndex.get(hash),
        };
      }
    }

    return { isDuplicate: false };
  }

  async register(url: string, hash: string, path: string): Promise<void> {
    const entry: DedupEntry = {
      url,
      hash,
      path,
      timestamp: new Date(),
    };

    this.urlIndex.set(url, path);
    this.hashIndex.set(hash, path);
    this.entries.push(entry);
  }

  async registerWithBuffer(url: string, buffer: Buffer, path: string): Promise<void> {
    const hash = this.computeHash(buffer);
    await this.register(url, hash, path);
  }

  getEntry(url: string): DedupEntry | undefined {
    const path = this.urlIndex.get(url);
    if (!path) return undefined;

    return this.entries.find((e) => e.path === path);
  }

  getStats(): { totalUnique: number; urlIndexed: number; hashIndexed: number } {
    return {
      totalUnique: this.entries.length,
      urlIndexed: this.urlIndex.size,
      hashIndexed: this.hashIndex.size,
    };
  }

  clear(): void {
    this.urlIndex.clear();
    this.hashIndex.clear();
    this.entries = [];
  }

  private computeHash(buffer: Buffer): string {
    return createHash('md5').update(buffer).digest('hex');
  }
}
