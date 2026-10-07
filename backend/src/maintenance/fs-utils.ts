import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else {
      try {
        const stat = await fs.stat(full);
        total += stat.size;
      } catch {
        // ignore disappearing files
      }
    }
  }
  return total;
}

export function assertInside(candidate: string, root: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = isAbsolute(candidate) ? resolve(candidate) : resolve(process.cwd(), candidate);
  if (resolvedCandidate === resolvedRoot) throw new Error('Refusing to delete workspace root');
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to delete path outside workspace: ${candidate}`);
  }
}
