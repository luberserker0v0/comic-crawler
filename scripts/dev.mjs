import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import process from 'node:process';
import readline from 'node:readline';

const isWindows = process.platform === 'win32';
const commandSpec = parseCommandSpec(process.env.COMICCRAWLER_DEV_COMMAND_JSON) ?? ['npm'];
const commandLabel = commandSpec.join(' ');
const backendHost = process.env.COMICCRAWLER_HOST ?? process.env.HOST ?? '127.0.0.1';
const frontendHost = process.env.COMICCRAWLER_FRONTEND_HOST ?? process.env.FRONTEND_HOST ?? '127.0.0.1';
let backendPort = Number.parseInt(process.env.COMICCRAWLER_PORT ?? process.env.PORT ?? '4100', 10);
let frontendPort = Number.parseInt(process.env.COMICCRAWLER_FRONTEND_PORT ?? process.env.FRONTEND_PORT ?? '5173', 10);
let backendStatusUrl = `http://${backendHost}:${backendPort}/api/status`;
let frontendUrl = `http://${frontendHost}:${frontendPort}`;
const readyTimeoutMs = Number.parseInt(process.env.COMICCRAWLER_DEV_READY_TIMEOUT_MS ?? '45000', 10);
const probeIntervalMs = Number.parseInt(process.env.COMICCRAWLER_DEV_PROBE_INTERVAL_MS ?? '500', 10);
const shutdownGraceMs = Number.parseInt(process.env.COMICCRAWLER_DEV_SHUTDOWN_GRACE_MS ?? '5000', 10);

const children = new Set();
let shuttingDown = false;
let shutdownPromise;

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  void shutdown(1);
});

async function main() {
  await resolveDevPorts();
  console.log('[dev] Preparing ComicCrawler development environment...');
  console.log(`[dev] Backend target:  ${backendStatusUrl}`);
  console.log(`[dev] Frontend URL:    ${frontendUrl}`);

  await runOnce('shared:build', ['run', 'build:shared']);

  const shared = spawnLabeled('shared', ['run', 'dev:shared']);
  const backend = spawnLabeled('backend', ['run', 'dev:backend']);

  await waitForServiceOrExit('backend', backend, backendStatusUrl, readyTimeoutMs);

  const frontend = spawnLabeled('frontend', ['run', 'dev:frontend'], handleFrontendLine);
  await waitForServiceOrExit('frontend', frontend, () => frontendUrl, readyTimeoutMs);

  if (process.env.COMICCRAWLER_DEV_EXIT_AFTER_READY === '1') {
    console.log('[dev] Exit-after-ready requested; stopping dev environment.');
    await shutdown(0);
    return;
  }

  const exitResult = await Promise.race([
    childExit(shared),
    childExit(backend),
    childExit(frontend),
  ]);

  if (!shuttingDown) {
    const code = exitResult.code ?? 1;
    console.error(`[dev] ${exitResult.label} exited${exitResult.signal ? ` with signal ${exitResult.signal}` : ` with code ${code}`}. Stopping dev environment.`);
    await shutdown(code);
  }
}

async function runOnce(label, args) {
  console.log(`[dev] Running ${label}: ${commandLabel} ${args.join(' ')}`);
  const child = spawnCommand(args, {
    cwd: process.cwd(),
    env: createChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  prefixStream(label, child.stdout);
  prefixStream(label, child.stderr);
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with code ${code}`}.`);
  }
}

function spawnLabeled(label, args, onLine) {
  console.log(`[dev] Starting ${label}: ${commandLabel} ${args.join(' ')}`);
  const child = spawnCommand(args, {
    cwd: process.cwd(),
    env: createChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
    detached: !isWindows,
  });
  children.add(child);
  childLabels.set(child, label);
  prefixStream(label, child.stdout, onLine);
  prefixStream(label, child.stderr, onLine);
  child.once('exit', () => {
    children.delete(child);
    childLabels.delete(child);
  });
  return child;
}

function spawnCommand(args, options) {
  const [command, ...prefixArgs] = commandSpec;
  const finalArgs = [...prefixArgs, ...args];
  if (isWindows && shouldRunThroughCmd(command)) {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', command, ...finalArgs], options);
  }
  return spawn(command, finalArgs, options);
}

function shouldRunThroughCmd(command) {
  if (process.env.COMICCRAWLER_DEV_COMMAND_JSON) {
    return false;
  }
  return !/\.(exe|com)$/i.test(command);
}

function parseCommandSpec(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // Fall through to the default npm command below.
  }
  throw new Error('COMICCRAWLER_DEV_COMMAND_JSON must be a JSON string array, e.g. ["npm"].');
}

function prefixStream(label, stream, onLine) {
  const reader = readline.createInterface({ input: stream });
  reader.on('line', (line) => {
    onLine?.(line);
    console.log(`[${label}] ${line}`);
  });
}

async function childExit(child) {
  const [code, signal] = await once(child, 'exit');
  return {
    label: getChildLabel(child),
    code,
    signal,
  };
}

function getChildLabel(child) {
  return childLabels.get(child) ?? `pid ${child.pid}`;
}

const childLabels = new Map();

async function waitForServiceOrExit(label, child, url, timeoutMs) {
  const result = await Promise.race([
    waitUntilReady(label, url, timeoutMs).then(() => ({ kind: 'ready' })),
    childExit(child).then((exit) => ({ kind: 'exit', exit })),
  ]);

  if (result.kind === 'ready') {
    return;
  }

  const code = result.exit.code ?? 1;
  throw new Error(`${label} exited before becoming ready${result.exit.signal ? ` with signal ${result.exit.signal}` : ` with code ${code}`}.`);
}

async function waitUntilReady(label, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  const getUrl = typeof url === 'function' ? url : () => url;
  while (Date.now() < deadline) {
    const currentUrl = getUrl();
    try {
      const statusCode = await httpStatus(currentUrl);
      if (statusCode >= 200 && statusCode < 500) {
        console.log(`[dev] ${label} ready: ${currentUrl} (${statusCode})`);
        return;
      }
      lastError = `HTTP ${statusCode}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(probeIntervalMs);
  }

  console.error(`[dev] ${label} not ready after ${Math.round(timeoutMs / 1000)}s: ${getUrl()}`);
  console.error(`[dev] Last ${label} probe error: ${lastError || 'unknown error'}`);
  if (label === 'backend') {
    console.error('[dev] Frontend was not started because the backend is not listening. Inspect the [backend] lines above.');
  }
  throw new Error(`${label} not ready: ${lastError || 'unknown error'}`);
}

function handleFrontendLine(line) {
  const cleanLine = stripAnsi(line);
  const match = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1):(\d+)/i.exec(cleanLine);
  if (!match?.[1]) {
    return;
  }
  const actualPort = Number.parseInt(match[1], 10);
  if (!Number.isFinite(actualPort) || actualPort === frontendPort) {
    return;
  }
  frontendPort = actualPort;
  frontendUrl = `http://${frontendHost}:${frontendPort}`;
  console.error(`[dev] Frontend dev server selected port ${frontendPort}; updating readiness probe to ${frontendUrl}.`);
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.setTimeout(3000, () => {
      request.destroy(new Error('probe timeout'));
    });
    request.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createChildEnv() {
  return {
    ...process.env,
    COMICCRAWLER_HOST: backendHost,
    COMICCRAWLER_PORT: String(backendPort),
    COMICCRAWLER_FRONTEND_HOST: frontendHost,
    COMICCRAWLER_FRONTEND_PORT: String(frontendPort),
    FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
    COMICCRAWLER_BOOT_TIMING: process.env.COMICCRAWLER_BOOT_TIMING ?? '1',
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--enable-source-maps'].filter(Boolean).join(' '),
  };
}

async function resolveDevPorts() {
  backendPort = await resolvePort({
    label: 'backend',
    host: backendHost,
    requestedPort: backendPort,
    explicit: Boolean(process.env.COMICCRAWLER_PORT ?? process.env.PORT),
  });
  frontendPort = await resolvePort({
    label: 'frontend',
    host: frontendHost,
    requestedPort: frontendPort,
    explicit: Boolean(process.env.COMICCRAWLER_FRONTEND_PORT ?? process.env.FRONTEND_PORT),
  });
  backendStatusUrl = `http://${backendHost}:${backendPort}/api/status`;
  frontendUrl = `http://${frontendHost}:${frontendPort}`;
}

async function resolvePort({ label, host, requestedPort, explicit }) {
  if (await canListen(host, requestedPort)) {
    return requestedPort;
  }

  if (explicit) {
    throw new Error(`${label} port ${requestedPort} is not available on ${host}. Choose another port with ${label === 'backend' ? 'COMICCRAWLER_PORT' : 'COMICCRAWLER_FRONTEND_PORT'}.`);
  }

  const fallbackPort = await findAvailablePort(host, requestedPort + 1);
  console.error(`[dev] Default ${label} port ${requestedPort} is not available on ${host}; using ${fallbackPort} instead.`);
  return fallbackPort;
}

function canListen(host, port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(host, startPort) {
  for (let port = startPort; port < startPort + 200; port += 1) {
    if (await canListen(host, port)) {
      return port;
    }
  }
  throw new Error(`No available port found on ${host} from ${startPort} to ${startPort + 199}.`);
}

async function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    const activeChildren = Array.from(children);
    if (activeChildren.length > 0) {
      console.error(`[dev] Stopping ${activeChildren.length} child process${activeChildren.length === 1 ? '' : 'es'}...`);
    }
    await Promise.all(activeChildren.map((child) => stopChildTree(child, shutdownGraceMs)));
    process.exit(code);
  })();
  return shutdownPromise;
}

async function stopChildTree(child, graceMs) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const label = getChildLabel(child);
  const exited = waitForChildExit(child, graceMs);
  if (isWindows) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await Promise.race([
      once(killer, 'exit').catch(() => undefined),
      delay(Math.min(graceMs, 1000)),
    ]);
  } else {
    killProcessGroup(child, 'SIGTERM');
  }

  const didExit = await exited;
  if (!didExit && !isWindows && child.exitCode === null && child.signalCode === null) {
    killProcessGroup(child, 'SIGKILL');
    await waitForChildExit(child, 1000);
  }
  if (child.exitCode === null && child.signalCode === null) {
    console.error(`[dev] Warning: ${label} did not exit within ${graceMs}ms.`);
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    child.once('exit', onExit);
  });
}

function killProcessGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    try {
      child.kill(signal);
    } catch (fallbackError) {
      if (fallbackError?.code !== 'ESRCH') {
        throw fallbackError;
      }
    }
  }
}

process.on('SIGINT', () => {
  void shutdown(0);
});
process.on('SIGTERM', () => {
  void shutdown(0);
});
