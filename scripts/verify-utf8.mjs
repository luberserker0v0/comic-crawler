import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');
const textExtensions = new Set([
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.txt',
  '.ps1',
]);

const skippedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'playwright-report',
  'test-results',
  '.next',
  '.turbo',
]);

const decoder = new TextDecoder('utf-8', { fatal: true });
const suspiciousFiles = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (skippedDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!textExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    const content = await readFile(fullPath);

    try {
      decoder.decode(content);
    } catch (error) {
      suspiciousFiles.push({
        path: path.relative(projectRoot, fullPath),
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (content.length >= 2) {
      const hasUtf16LeBom = content[0] === 0xff && content[1] === 0xfe;
      const hasUtf16BeBom = content[0] === 0xfe && content[1] === 0xff;
      if (hasUtf16LeBom || hasUtf16BeBom) {
        suspiciousFiles.push({
          path: path.relative(projectRoot, fullPath),
          reason: 'Detected UTF-16 BOM; expected UTF-8.',
        });
      }
    }
  }
}

await walk(projectRoot);

if (suspiciousFiles.length > 0) {
  console.error('UTF-8 verification failed for these files:');
  for (const file of suspiciousFiles) {
    console.error(`- ${file.path}: ${file.reason}`);
  }
  process.exit(1);
}

console.log('UTF-8 verification passed.');
