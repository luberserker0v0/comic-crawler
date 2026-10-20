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
  await walkPreviewFiles(rootDir, rootDir, limit, previewFiles);
  return previewFiles;
}

async function walkPreviewFiles(rootDir: string, currentDir: string, limit: number,
  files: LocalTaskPreviewFile[]): Promise<void> {
  if (files.length >= limit) return;
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= limit) return;
    const absolutePath = join(currentDir, entry.name);
    if (entry.isDirectory()) await walkPreviewFiles(rootDir, absolutePath, limit, files);
    else files.push(await createPreviewFile(rootDir, absolutePath, entry.name));
  }
}

async function createPreviewFile(rootDir: string, absolutePath: string,
  name: string): Promise<LocalTaskPreviewFile> {
  const stats = await fs.stat(absolutePath);
  return { name, relativePath: relative(rootDir, absolutePath), size: stats.size,
    modifiedAt: stats.mtime, isImage: isPreviewImage(absolutePath) };
}

export async function buildTaskDownloadPreview(
  taskId: string,
  result?: { outputPath?: string; metadata?: Record<string, unknown> | undefined }
) {
  if (!result?.outputPath) {
    return null;
  }
  const rootDir = await resolvePreviewRoot(result as { outputPath: string; metadata?: Record<string, unknown> });
  try {
    const stats = await fs.stat(rootDir);
    if (!stats.isDirectory()) return null;
    const files = (await collectPreviewFiles(rootDir)).map((file) => addPreviewUrl(taskId, file));
    return { rootDir, files, totalFiles: files.length };
  } catch {
    return null;
  }
}

function addPreviewUrl(taskId: string, file: LocalTaskPreviewFile): LocalTaskPreviewFile {
  const path = encodeURIComponent(file.relativePath);
  return { ...file, url: file.isImage
    ? `/api/tasks/${encodeURIComponent(taskId)}/preview-file?path=${path}` : undefined };
}

export async function resolvePreviewRoot(result: { outputPath: string; metadata?: Record<string, unknown> | undefined }): Promise<string> {
  return isAbsolute(result.outputPath) ? result.outputPath : join(process.cwd(), result.outputPath);
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
