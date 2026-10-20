import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export function hasWaitingVerificationContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (
    context.antiBotChallenge === true ||
    context.humanVerificationProfileUnavailable === true ||
    typeof context.challengeDiscoveryId === 'string'
  ) return true;
  return Object.values(context).some((entry) => hasWaitingVerificationContext(entry));
}

export function isPathInsideDir(candidate: string, dir: string): boolean {
  const resolvedDir = resolve(dir);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === resolvedDir) return true;
  const rel = relative(resolvedDir, resolvedCandidate);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

export async function deleteTaskOutputDir(
  outputPath: string,
  downloadDir?: string
): Promise<{ deleted: boolean; skipped?: string }> {
  const base = downloadDir ?? './downloads';
  const candidate = isAbsolute(outputPath) ? outputPath : resolve(process.cwd(), outputPath);
  if (!isPathInsideDir(candidate, resolve(process.cwd(), base)) && !isPathInsideDir(candidate, base)) {
    return { deleted: false, skipped: `outputPath outside download directory: ${outputPath}` };
  }
  const validationError = await validateOutputDirectory(candidate, outputPath);
  if (validationError) return { deleted: false, skipped: validationError };
  try {
    await fs.rm(candidate, { recursive: true, force: true });
    return { deleted: true };
  } catch (error) {
    return { deleted: false, skipped: error instanceof Error ? error.message : String(error) };
  }
}

async function validateOutputDirectory(candidate: string, outputPath: string): Promise<string | undefined> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isDirectory() ? undefined : `outputPath is not a directory: ${outputPath}`;
  } catch {
    return `outputPath not found: ${outputPath}`;
  }
}
