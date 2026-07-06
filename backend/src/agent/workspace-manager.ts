import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface WorkspacePaths {
  selectors: string;
  parser: string;
  session: string;
  versions: string;
  attemptsDir: string;
}

export class WorkspaceManager {
  private workspacePath: string;
  private adapterBasePath: string;

  constructor(workspacePath: string, adapterId: string) {
    this.workspacePath = workspacePath;
    this.adapterBasePath = join(workspacePath, adapterId);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.adapterBasePath, { recursive: true });
    await fs.mkdir(join(this.adapterBasePath, 'attempts'), { recursive: true });
  }

  getPaths(): WorkspacePaths {
    return {
      selectors: join(this.adapterBasePath, 'selectors.ts'),
      parser: join(this.adapterBasePath, 'parser.ts'),
      session: join(this.adapterBasePath, 'session.json'),
      versions: join(this.adapterBasePath, 'versions.json'),
      attemptsDir: join(this.adapterBasePath, 'attempts'),
    };
  }

  async getSelectors(): Promise<string | null> {
    const path = join(this.adapterBasePath, 'selectors.ts');
    try {
      return await fs.readFile(path, 'utf-8');
    } catch {
      return null;
    }
  }

  async getParser(): Promise<string | null> {
    const path = join(this.adapterBasePath, 'parser.ts');
    try {
      return await fs.readFile(path, 'utf-8');
    } catch {
      return null;
    }
  }

  async saveAttempt(attemptNumber: number, content: string): Promise<void> {
    const attemptsDir = join(this.adapterBasePath, 'attempts');
    await fs.mkdir(attemptsDir, { recursive: true });

    const path = join(attemptsDir, `attempt-${attemptNumber}.json`);
    await fs.writeFile(path, JSON.stringify({ attemptNumber, content, timestamp: new Date() }, null, 2));
  }

  async getAttempts(): Promise<Array<{ attemptNumber: number; content: string; timestamp: Date }>> {
    const attemptsDir = join(this.adapterBasePath, 'attempts');
    try {
      const files = await fs.readdir(attemptsDir);
      const attempts = await Promise.all(
        files
          .filter((f) => f.startsWith('attempt-') && f.endsWith('.json'))
          .map(async (file) => {
            const content = await fs.readFile(join(attemptsDir, file), 'utf-8');
            return JSON.parse(content) as { attemptNumber: number; content: string; timestamp: Date };
          })
      );
      return attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
    } catch {
      return [];
    }
  }

  async cleanup(maxAgeDays = 7): Promise<void> {
    const attemptsDir = join(this.adapterBasePath, 'attempts');
    try {
      const files = await fs.readdir(attemptsDir);
      const now = Date.now();
      const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const path = join(attemptsDir, file);
        const stat = await fs.stat(path);
        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(path);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
