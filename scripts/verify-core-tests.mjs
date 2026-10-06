import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const coreBackendTests = [
  'tests/unit/server/task-routes.test.ts',
  'tests/unit/task/manager.test.ts',
  'tests/unit/task/queue.test.ts',
  'tests/unit/crawler/engine.test.ts',
  'tests/unit/crawler/image-downloader.test.ts',
  'tests/unit/crawler/anti-bot.test.ts',
  'tests/unit/challenge/cdp-handoff.test.ts',
  'tests/unit/adapter/sites/happymh/adapter.test.ts',
  'tests/unit/selector-discovery/task-markdown.test.ts',
  'tests/unit/server/adapter-routes.test.ts',
  'tests/unit/server/adapter-draft-routes.test.ts',
];

// Everything else under backend/tests/unit. These run in the full backend
// jest suite (CI runs it as a separate step) but are intentionally outside
// the quick core gate. Keep this list closed-world: any test file present
// on disk but absent from BOTH lists fails this script, forcing a conscious
// core/non-core triage for every new test file.
const nonCoreBackendTests = [
  // Adapter + extraction 介面
  'tests/unit/adapter/dynamic-site-adapter.test.ts',
  'tests/unit/adapter/registry.test.ts',
  'tests/unit/adapter/sites/kuronavi/adapter.test.ts',
  'tests/unit/adapter/url-resolver.test.ts',
  'tests/unit/crawler/chapter-selection.test.ts',
  'tests/unit/crawler/extraction/dom.test.ts',
  'tests/unit/crawler/html-parser.test.ts',
  // Agent 維運模組群
  'tests/unit/agent/admin-service.test.ts',
  'tests/unit/agent/code-validator.test.ts',
  'tests/unit/agent/error-context.test.ts',
  'tests/unit/agent/maintenance-loop.test.ts',
  'tests/unit/agent/notifier.test.ts',
  'tests/unit/agent/promotion-manager.test.ts',
  'tests/unit/agent/rollback-manager.test.ts',
  'tests/unit/agent/session-manager.test.ts',
  'tests/unit/agent/trigger-manager.test.ts',
  'tests/unit/agent/version-manager.test.ts',
  'tests/unit/agent/workspace-factory.test.ts',
  // Challenge / config / server 其餘
  'tests/unit/challenge/registry.test.ts',
  'tests/unit/challenge/strategy-loader.test.ts',
  'tests/unit/cli/ui.test.ts',
  'tests/unit/config/runtime.test.ts',
  'tests/unit/config/schema.test.ts',
  'tests/unit/server/agent-routes.test.ts',
  'tests/unit/server/api-docs-route.test.ts',
  'tests/unit/server/app.test.ts',
  'tests/unit/server/selector-discovery-routes.test.ts',
  // 儲存 / 基礎設施
  'tests/unit/bootstrap/graceful-shutdown.test.ts',
  'tests/unit/error/handler.test.ts',
  'tests/unit/events/bus.test.ts',
  'tests/unit/fixtures/dom-readiness.test.ts',
  'tests/unit/image/compressor.test.ts',
  'tests/unit/image/converter.test.ts',
  'tests/unit/image/dedup.test.ts',
  'tests/unit/maintenance/service.test.ts',
  'tests/unit/security/ssrf-protection.test.ts',
  'tests/unit/storage/json-store.test.ts',
  // Selector-discovery 其餘（core 僅收 task-markdown）
  'tests/unit/selector-discovery/adapter-draft-runtime.test.ts',
  'tests/unit/selector-discovery/adapter-implementation.test.ts',
  'tests/unit/selector-discovery/ao-client.test.ts',
  'tests/unit/selector-discovery/bundle-manager.test.ts',
  'tests/unit/selector-discovery/eval-suite.test.ts',
  'tests/unit/selector-discovery/markdown-candidate.test.ts',
  'tests/unit/selector-discovery/provider-config.test.ts',
  'tests/unit/selector-discovery/service.test.ts',
  'tests/unit/selector-discovery/settings-store.test.ts',
];

function collectUnitTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectUnitTests(full));
    } else if (entry.endsWith('.test.ts')) {
      out.push(relative(join(process.cwd(), 'backend'), full).split(sep).join('/'));
    }
  }
  return out.sort();
}

const onDisk = collectUnitTests(join(process.cwd(), 'backend', 'tests', 'unit'));
const known = new Set([...coreBackendTests, ...nonCoreBackendTests]);
const untracked = onDisk.filter((file) => !known.has(file));
const stale = [...known].filter((file) => !onDisk.includes(file));

if (stale.length > 0) {
  console.error(`[verify-core-tests] stale entries (file removed, list not updated):\n - ${stale.join('\n - ')}`);
  process.exit(1);
}

if (untracked.length > 0) {
  console.error(
    `[verify-core-tests] untracked test files (add to coreBackendTests or nonCoreBackendTests):\n - ${untracked.join('\n - ')}`
  );
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const npmArgsPrefix = isWindows ? ['/d', '/c', 'npm'] : [];

const child = spawn(npmCommand, [
  ...npmArgsPrefix,
  'run',
  '-w',
  'backend',
  'test',
  '--',
  '--runInBand',
  ...coreBackendTests,
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
