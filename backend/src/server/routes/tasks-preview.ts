import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';

export interface LocalTaskPreviewFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: Date;
  isImage: boolean;
  url?: string;
}

export async function collectPreviewFiles(rootDir: string, limit = 24): Promise<LocalTaskPreviewFile[]> {
  const previewFiles: LocalTaskPreviewFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (previewFiles.length >= limit) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (previewFiles.length >= limit) {
        return;
      }

      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const stats = await fs.stat(absolutePath);
      previewFiles.push({
        name: entry.name,
        relativePath: relative(rootDir, absolutePath),
        size: stats.size,
        modifiedAt: stats.mtime,
        isImage: isPreviewImage(absolutePath),
      });
    }
  }

  await walk(rootDir);
  return previewFiles;
}

export async function buildTaskDownloadPreview(
  taskId: string,
  result?: { outputPath?: string; metadata?: Record<string, unknown> | undefined }
) {
  if (!result?.outputPath) {
    return null;
  }

  const rootDir = await resolvePreviewRoot({
    outputPath: result.outputPath,
    metadata: result.metadata,
  });

  try {
    const stats = await fs.stat(rootDir);
    if (!stats.isDirectory()) {
      return null;
    }

    const files = (await collectPreviewFiles(rootDir)).map((file) => ({
      ...file,
      url: file.isImage ? `/api/tasks/${encodeURIComponent(taskId)}/preview-file?path=${encodeURIComponent(file.relativePath)}` : undefined,
    }));
    return {
      rootDir,
      files,
      totalFiles: files.length,
    };
  } catch {
    return null;
  }
}

export async function resolvePreviewRoot(result: { outputPath: string; metadata?: Record<string, unknown> | undefined }): Promise<string> {
  const directRoot = isAbsolute(result.outputPath) ? result.outputPath : join(process.cwd(), result.outputPath);
  try {
    const stats = await fs.stat(directRoot);
    if (stats.isDirectory()) return directRoot;
  } catch {
    // Fall back to the legacy layout below.
  }

  const title = typeof result.metadata?.title === 'string' ? result.metadata.title : null;
  return title ? join(directRoot, title) : directRoot;
}

export function isPreviewImage(path: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].includes(extname(path).toLowerCase());
}

export function contentTypeForImage(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}
