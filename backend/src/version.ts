import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageManifest {
  version?: unknown;
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8')
) as PackageManifest;

if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
  throw new Error('backend/package.json must define a non-empty version');
}

export const COMICCRAWLER_VERSION = manifest.version;
