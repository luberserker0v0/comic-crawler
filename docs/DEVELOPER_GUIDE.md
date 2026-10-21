# ComicCrawler Developer Guide

## 1. Requirements

- Node.js 22.12 or newer.
- npm 9 or newer.
- Git.
- A consumer-provided browser runtime for Browser Client integration work.

## 2. Local setup

Enter the source-of-truth repository root, then run the workspace commands:

```bash
cd repo
npm install
npm run dev
```

The launcher starts these processes:

1. Shared package watcher.
2. Backend API.
3. Frontend dev server.

The frontend starts after the backend health check passes.

Expected addresses:

- Backend: `http://127.0.0.1:4100/`
- Frontend: `http://127.0.0.1:5173/`
- Swagger UI: `http://127.0.0.1:4100/api-docs`

The frontend port can fall back automatically.
Explicit port values do not fall back.

### 2.1 UTF-8 console

Use the UTF-8 launcher on Windows:

```bash
npm run dev:utf8
```

Validate edited text files:

```bash
npm run verify:utf8
```

### 2.2 Controlled smoke run

Start the full development stack once.
Exit after both services become ready:

```bash
COMICCRAWLER_DEV_EXIT_AFTER_READY=1 npm run dev
```

PowerShell:

```powershell
$env:COMICCRAWLER_DEV_EXIT_AFTER_READY = "1"
npm run dev
```

## 3. Repository layout

```text
agent/                  AO bundles and evaluation cases
backend/                API, crawler, tasks, adapters
browser-client-sdk/     runtime-neutral Browser Client SDK
docs/                   project documentation
frontend/               React and Vite WebUI
scripts/                development and verification scripts
shared/                 shared contracts and defaults
```

Runtime data does not belong in Git.
Generated build and test output does not belong in Git.

### 3.1 Generated output and cleanup

Build output remains beside each workspace because package entrypoints consume
those `dist/` directories. Test reports, coverage, and temporary development
output are collected under `.artifacts/`.

Run the safe default cleanup:

```bash
npm run clean
```

Use a narrower cleanup when needed:

```bash
npm run clean:build
npm run clean:test
npm run clean:temp
npm run clean:deps
npm run rebuild
```

The default cleanup removes only reproducible build, test, and temporary
output. It never removes `data/`, downloads, credentials, fixtures, or generated
adapters. Runtime retention and reset operations use dedicated maintenance
commands instead of a general-purpose clean command.

## 4. Development startup behavior

`npm run dev` builds `shared` before starting watchers.
The backend imports `@comiccrawler/shared` through its package entrypoint.
A fresh checkout does not have `shared/dist` yet.

Service logs use prefixes:

```text
[shared] ...
[backend] ...
[frontend] ...
[dev] backend ready: http://127.0.0.1:4100/api/status (200)
[dev] frontend ready: http://127.0.0.1:5173 (200)
```

## 5. Runtime environment

Environment variables override persisted deployment settings.

| Setting | Environment variable | Default |
|---|---|---|
| Backend host | `COMICCRAWLER_HOST` | `127.0.0.1` |
| Backend port | `COMICCRAWLER_PORT` | `4100` |
| Frontend port | `COMICCRAWLER_FRONTEND_PORT` | `5173` |
| Frontend API target | `COMICCRAWLER_API_TARGET` | backend host and port |
| Frontend WS target | `COMICCRAWLER_WS_TARGET` | backend host and port |
| Runtime data | `COMICCRAWLER_DATA_PATH` | development: `./data` |
| Agent workspaces | `AGENT_WORKSPACE_PATH` | `<data-path>/agent-workspaces` |
| AO bundle | `AO_BUNDLE_PATH` | `agent/ao/selector-discovery` |
| API security mode | `COMICCRAWLER_API_SECURITY_MODE` | `public` |
| API security secret | `COMICCRAWLER_API_SECURITY_SECRET_PATH` | unset |
| Static frontend | `STATIC_DIR` | unset |

Example:

```bash
COMICCRAWLER_PORT=4200 COMICCRAWLER_FRONTEND_PORT=5174 npm run dev
```

PowerShell:

```powershell
$env:COMICCRAWLER_PORT = "4200"
$env:COMICCRAWLER_FRONTEND_PORT = "5174"
npm run dev
```

ComicCrawler resolves one data root at startup.
Production uses the operating system application-data directory by default.

Runtime areas include:

- `config/`
- `user/`
- `runtime/`
- `agent-workspaces/`
- `logs/`

## 6. Browser Client development

Build the SDK:

```bash
npm run build:browser-client-sdk
```

The client performs these actions:

1. Reads the discovery document.
2. Enrolls once and persists the issued credential.
3. Opens one outbound command WebSocket.
4. Executes semantic page commands through the injected executor.

ComicCrawler never launches Chromium in the backend process.

See [Browser Client SDK](../browser-client-sdk/README.md) for the executor and
state-store contracts.

## 7. Container image

Build the production image from the repository root:

```bash
docker compose build --pull app
```

The multi-stage Dockerfile performs these actions:

1. Installs locked workspace dependencies with `npm ci`.
2. Builds shared contracts, Browser Client SDK, backend, and WebUI.
3. Removes development-only dependencies.
4. Runs the service as the unprivileged `app` user.
5. Exposes port `4100` and checks `/api/status` for container health.

Set image metadata for release builds:

```bash
COMICCRAWLER_IMAGE_VERSION=0.2.0 \
COMICCRAWLER_IMAGE_REVISION=<git-commit> \
docker compose build app
```

PowerShell:

```powershell
$env:COMICCRAWLER_IMAGE_VERSION = "0.2.0"
$env:COMICCRAWLER_IMAGE_REVISION = git rev-parse HEAD
docker compose build app
```

See [Docker deployment](DOCKER.md) for container replacement and runtime
verification.

## 8. Verification gates

### 8.1 Development launcher

Use this gate for launcher or port changes:

```bash
npm run test:dev
```

### 8.2 Test layers

Run one test layer from the repository root:

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

Run every automated test layer:

```bash
npm run test:all
```

Use a focused workspace command when needed:

```bash
npm run test:unit:backend
npm run test:unit:frontend
npm run test:unit:browser-client-sdk
npm run test:integration:backend
npm run test:integration:frontend
npm run test:e2e:chromium
```

### 8.3 Daily gate

Use this gate for normal code changes:

```bash
npm run verify:quick
```

It performs these checks:

1. Runs the real development smoke test.
2. Builds all workspaces.
3. Verifies UTF-8 files.
4. Runs core backend tests.
5. Runs the REST-only flow.

### 8.4 Full local gate

Use this gate for browser and WebUI flows:

```bash
npm run verify:local
```

It performs these checks:

1. Runs `verify:quick`.
2. Starts the E2E Browser Client fixture.
3. Runs the Playwright suite.

### 8.5 Focused gates

```bash
npm run audit:production
npm run test:api
npm run -w backend test:coverage -- --runInBand
npm run -w frontend test:coverage -- --runInBand
npm run -w browser-client-sdk test:coverage
```

`audit:production` excludes development-only tooling and fails when any
production dependency has a known vulnerability at any severity.

See the [test strategy](development/TDD.md) for test layers and merge gates.

## 9. Troubleshooting

### 9.1 Frontend returns HTTP 502

Check the terminal in this order:

1. Find the backend readiness message.
2. Inspect earlier backend errors.
3. Confirm the configured backend port.
4. Confirm the frontend API target.

The frontend proxy requires a reachable backend.

### 9.2 A port is unavailable

Follow these steps:

1. Remove explicit port overrides.
2. Start `npm run dev` again.
3. Read the printed frontend URL.

Set a different backend port when required:

```powershell
$env:COMICCRAWLER_PORT = "4200"
npm run dev
```

### 9.3 Tests do not exit

Use Jest handle detection:

```bash
npm run -w frontend test -- --runInBand --detectOpenHandles
```

Check these resources:

1. WebSocket connections.
2. Timers.
3. Pending HTTP requests.
4. Mounted React effects.

## 10. Development references

- [Contributing](../CONTRIBUTING.md)
- [Architecture](ARCHITECTURE.md)
- [Adapter development](ADAPTERS.md)
- [AO Selector Discovery](AO_SELECTOR_DISCOVERY.md)
- [Reliability](RELIABILITY.md)
- [API Reference](API.md)
- [Docker deployment](DOCKER.md)
