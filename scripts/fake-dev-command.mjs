import http from 'node:http';
import process from 'node:process';

const [, , command, target] = process.argv;

if (command !== 'run') {
  console.error(`Unsupported fake command: ${process.argv.slice(2).join(' ')}`);
  process.exit(2);
}

if (target === 'build:shared') {
  process.exit(0);
}

if (target === 'dev:shared') {
  await runServer(Number.parseInt(requiredEnv('FAKE_DEV_SHARED_PORT'), 10), () => 'shared ok');
}

if (target === 'dev:backend') {
  if (process.env.FAKE_DEV_BACKEND_MODE === 'exit') {
    console.error('fake backend exited before ready');
    process.exit(41);
  }
  const port = Number.parseInt(requiredEnv('COMICCRAWLER_PORT'), 10);
  await runServer(port, (url) => url === '/api/status' ? JSON.stringify({ data: { ok: true } }) : 'backend ok');
}

if (target === 'dev:frontend') {
  if (process.env.FAKE_DEV_FRONTEND_MODE === 'exit') {
    console.error('fake frontend exited before ready');
    process.exit(42);
  }
  const port = Number.parseInt(requiredEnv('COMICCRAWLER_FRONTEND_PORT'), 10);
  await runServer(port, () => '<!doctype html><title>fake frontend</title>');
}

console.error(`Unsupported fake target: ${target}`);
process.exit(2);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return value;
}

async function runServer(port, responseForUrl) {
  const server = http.createServer((request, response) => {
    const body = responseForUrl(request.url ?? '/');
    response.statusCode = 200;
    response.end(body);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => undefined);
}
