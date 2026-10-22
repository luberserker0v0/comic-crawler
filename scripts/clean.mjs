import { access, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const targets = Object.freeze({
  build: [
    'backend/dist', 'frontend/dist', 'shared/dist', 'browser-client-sdk/dist',
    'browser-provider-sdk/dist', 'backend/tsconfig.tsbuildinfo',
    'frontend/tsconfig.tsbuildinfo', 'shared/tsconfig.tsbuildinfo',
    'browser-client-sdk/tsconfig.tsbuildinfo',
  ],
  test: [
    '.artifacts/coverage', '.artifacts/playwright', '.artifacts/test-temp',
    'backend/coverage', 'frontend/coverage', 'playwright-report', 'test-results',
    'backend/tests/__tmp__', 'backend/tests/integration/__tmp__',
    'backend/tests/unit/agent/__tmp__', 'backend/tests/unit/crawler/__tmp__',
    'backend/tests/unit/maintenance/__tmp__', 'backend/tests/unit/server/__tmp__',
    'backend/tests/unit/storage/__tmp__', 'backend/tests/unit/task/__tmp__',
  ],
  temp: ['.artifacts/dev-logs', '.tmp-dev-logs', 'browser-provider.local.tmp'],
  deps: ['node_modules', 'backend/node_modules', 'browser-client-sdk/node_modules',
    'frontend/node_modules', 'shared/node_modules'],
});

export async function clean(root, requestedScope = 'all', logger = console.log) {
  const scopes = resolveScopes(requestedScope);
  const removed = [];
  for (const scope of scopes) {
    for (const target of targets[scope]) {
      if (await removeTarget(root, target)) removed.push(target);
    }
  }
  logger(removed.length ? `[clean] Removed ${removed.length} target(s).` : '[clean] Nothing to remove.');
  return removed;
}

function resolveScopes(scope) {
  if (scope === 'all') return ['build', 'test', 'temp'];
  if (Object.hasOwn(targets, scope)) return [scope];
  throw new Error(`Unknown clean scope "${scope}". Expected all, build, test, temp, or deps.`);
}

async function removeTarget(root, target) {
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(absoluteRoot, target);
  assertInsideRoot(absoluteRoot, absoluteTarget);
  if (!(await exists(absoluteTarget))) return false;
  await rm(absoluteTarget, { recursive: true, force: true });
  console.log(`[clean] ${target}`);
  return true;
}

function assertInsideRoot(root, target) {
  const rel = relative(root, target);
  if (!rel || rel.startsWith('..') || resolve(root, rel) !== target) {
    throw new Error(`Refusing to clean path outside the repository: ${target}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

async function main() {
  const scope = process.argv[2] ?? 'all';
  await clean(projectRoot, scope);
}

if (isMainModule()) await main();
