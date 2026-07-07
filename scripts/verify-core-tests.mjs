import { spawn } from 'node:child_process';
import process from 'node:process';

const coreBackendTests = [
  'tests/unit/server/task-routes.test.ts',
  'tests/unit/task/manager.test.ts',
  'tests/unit/task/queue.test.ts',
  'tests/unit/crawler/engine.test.ts',
  'tests/unit/crawler/image-downloader.test.ts',
  'tests/unit/crawler/anti-bot.test.ts',
  'tests/unit/adapter/sites/happymh/adapter.test.ts',
  'tests/unit/selector-discovery/task-markdown.test.ts',
  'tests/unit/selector-discovery/happymh-self-ao.test.ts',
  'tests/unit/server/adapter-routes.test.ts',
];

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
