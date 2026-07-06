import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const devScript = resolve(repoRoot, 'scripts/dev.mjs');
const fakeCommand = resolve(repoRoot, 'scripts/fake-dev-command.mjs');

test('npm run dev cleans up shared when backend exits before ready', async () => {
  const sharedPort = await getFreePort();
  const backendPort = await getFreePort();
  const frontendPort = await getFreePort();

  const child = spawnDev({
    FAKE_DEV_SHARED_PORT: String(sharedPort),
    FAKE_DEV_BACKEND_MODE: 'exit',
    COMICCRAWLER_PORT: String(backendPort),
    COMICCRAWLER_FRONTEND_PORT: String(frontendPort),
  });

  const exit = await waitForExit(child);
  assert.notEqual(exit.code, 0);
  assert.match(exit.output, /backend exited before becoming ready/);
  await assertPortClosed(sharedPort);
});

test('npm run dev cleans up backend when frontend exits before ready', async () => {
  const sharedPort = await getFreePort();
  const backendPort = await getFreePort();
  const frontendPort = await getFreePort();

  const child = spawnDev({
    FAKE_DEV_SHARED_PORT: String(sharedPort),
    FAKE_DEV_FRONTEND_MODE: 'exit',
    COMICCRAWLER_PORT: String(backendPort),
    COMICCRAWLER_FRONTEND_PORT: String(frontendPort),
  });

  await waitForHttpOk(`http://127.0.0.1:${backendPort}/api/status`);
  const exit = await waitForExit(child);
  assert.notEqual(exit.code, 0);
  assert.match(exit.output, /frontend exited before becoming ready/);
  await assertPortClosed(backendPort);
});

test('real npm run dev reaches ready and releases ports on test shutdown', async () => {
  const backendPort = await getFreePort();
  const frontendPort = await getFreePort();

  const child = spawnRealNpmDev({
    COMICCRAWLER_PORT: String(backendPort),
    COMICCRAWLER_FRONTEND_PORT: String(frontendPort),
    COMICCRAWLER_DEV_EXIT_AFTER_READY: '1',
    COMICCRAWLER_DEV_READY_TIMEOUT_MS: '30000',
    COMICCRAWLER_DEV_PROBE_INTERVAL_MS: '100',
    COMICCRAWLER_DEV_SHUTDOWN_GRACE_MS: '5000',
  });

  const exit = await waitForExit(child);
  assert.equal(exit.code, 0, exit.output);
  assert.match(exit.output, /backend ready:/);
  assert.match(exit.output, /frontend ready:/);
  assert.match(exit.output, /Exit-after-ready requested/);
  await assertPortClosed(backendPort);
  await assertPortClosed(frontendPort);
});

test('real npm run dev falls back when the default frontend port is unavailable', async () => {
  const backendPort = await getFreePort();
  const defaultFrontendPortBlocker = await tryListen(5173);

  try {
    const child = spawnRealNpmDev({
      COMICCRAWLER_PORT: String(backendPort),
      COMICCRAWLER_DEV_EXIT_AFTER_READY: '1',
      COMICCRAWLER_DEV_READY_TIMEOUT_MS: '30000',
      COMICCRAWLER_DEV_PROBE_INTERVAL_MS: '100',
      COMICCRAWLER_DEV_SHUTDOWN_GRACE_MS: '5000',
    });

    const exit = await waitForExit(child);
    assert.equal(exit.code, 0, exit.output);
    assert.match(exit.output, /Default frontend port 5173 is not available/);
    assert.match(exit.output, /frontend ready: http:\/\/127\.0\.0\.1:(?!5173)\d+/);
    await assertPortClosed(backendPort);
  } finally {
    await closeServer(defaultFrontendPortBlocker);
  }
});

test('npm run dev fails fast when an explicitly configured frontend port is unavailable', async () => {
  const backendPort = await getFreePort();
  const blockedFrontendPort = await getFreePort();
  const blocker = await listenOn(blockedFrontendPort);

  try {
    const child = spawnRealNpmDev({
      COMICCRAWLER_PORT: String(backendPort),
      COMICCRAWLER_FRONTEND_PORT: String(blockedFrontendPort),
      COMICCRAWLER_DEV_EXIT_AFTER_READY: '1',
      COMICCRAWLER_DEV_READY_TIMEOUT_MS: '5000',
      COMICCRAWLER_DEV_PROBE_INTERVAL_MS: '100',
    });

    const exit = await waitForExit(child);
    assert.notEqual(exit.code, 0);
    assert.match(exit.output, new RegExp(`frontend port ${blockedFrontendPort} is not available`));
    assert.doesNotMatch(exit.output, /Starting backend:/);
    await assertPortClosed(backendPort);
  } finally {
    await closeServer(blocker);
  }
});

function spawnDev(extraEnv) {
  const child = spawn(process.execPath, [devScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
      COMICCRAWLER_DEV_COMMAND_JSON: JSON.stringify([process.execPath, fakeCommand]),
      COMICCRAWLER_DEV_READY_TIMEOUT_MS: '5000',
      COMICCRAWLER_DEV_PROBE_INTERVAL_MS: '50',
      COMICCRAWLER_DEV_SHUTDOWN_GRACE_MS: '5000',
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return child;
}

function spawnRealNpmDev(extraEnv) {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npm', 'run', 'dev'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...extraEnv,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  return spawn('npm', ['run', 'dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForExit(child) {
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const [code, signal] = await once(child, 'exit');
  return { code, signal, output };
}

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert(address && typeof address !== 'string');
  return address.port;
}

async function tryListen(port) {
  try {
    return await listenOn(port);
  } catch {
    return null;
  }
}

async function listenOn(port) {
  const server = http.createServer((_request, response) => {
    response.end('blocked');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function waitForHttpOk(url) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const status = await httpStatus(url);
      if (status >= 200 && status < 500) return;
      lastError = new Error(`HTTP ${status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function assertPortClosed(port) {
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 5000;
  let lastStatus;
  while (Date.now() < deadline) {
    try {
      lastStatus = await httpStatus(url);
    } catch {
      return;
    }
    await delay(50);
  }
  assert.fail(`Expected port ${port} to be closed, but ${url} still returned ${lastStatus}`);
}

function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.setTimeout(1000, () => {
      request.destroy(new Error('probe timeout'));
    });
    request.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
