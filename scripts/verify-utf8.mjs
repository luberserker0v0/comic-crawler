import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
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
  'data',
  'playwright-report',
  'test-results',
  '.next',
  '.turbo',
]);

const decoder = new TextDecoder('utf-8', { fatal: true });
const suspiciousFiles = [];
const commonBig5MojibakeFragments = [
  0x876C,
  0x95B0,
  0x5697,
  0x929D,
  0x747C,
  0x9758,
  0x7507,
  0x64A0,
  0x59A4,
  0x8129,
  0x6597,
  0x6D31,
  0x60B4,
].map((codePoint) => String.fromCodePoint(codePoint));
const mojibakePatterns = [
  { pattern: /\uFFFD/u, reason: 'Detected Unicode replacement character U+FFFD.' },
  { pattern: /[\uE000-\uF8FF]/u, reason: 'Detected private-use characters that often indicate mojibake.' },
  { pattern: /[\u0080-\u009F]/u, reason: 'Detected C1 control characters that often indicate mojibake.' },
  { pattern: /(?:Â|Ã|Å|Æ|Ç|È|É|Ê|Ë|Ì|Í|Î|Ï|Ð|Ñ|Ò|Ó|Ô|Õ|Ö|Ø|Ù|Ú|Û|Ü|Ý|Þ|ß)[\u0080-\uFFFF]/u, reason: 'Detected common UTF-8-as-Latin-1 mojibake pattern.' },
  { pattern: new RegExp(`(?:${commonBig5MojibakeFragments.join('|')})`, 'u'), reason: 'Detected common Big5/CP950 mojibake fragments.' },
];

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

    let text;
    try {
      text = decoder.decode(content);
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

    for (const { pattern, reason } of mojibakePatterns) {
      const match = pattern.exec(text);
      if (match) {
        suspiciousFiles.push({
          path: path.relative(projectRoot, fullPath),
          reason: `${reason} Matched "${match[0]}".`,
        });
        break;
      }
    }
  }
}

await walk(projectRoot);

if (suspiciousFiles.length > 0) {
  console.error('UTF-8/mojibake verification failed for these files:');
  for (const file of suspiciousFiles) {
    console.error(`- ${file.path}: ${file.reason}`);
  }
  process.exit(1);
}

console.log('UTF-8/mojibake verification passed.');
