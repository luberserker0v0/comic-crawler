# ComicCrawler Developer Guide

## 1. Requirements

- Node.js 20.19 or newer.
- npm 9 or newer.
- Git.
- Chromium for local Browser Provider work.

## 2. Local setup

Run commands from the repository root:

```bash
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
browser-provider-sdk/   user-side browser client and SDK
docs/                   project documentation
frontend/               React and Vite WebUI
scripts/                development and verification scripts
shared/                 shared contracts and defaults
```

Runtime data does not belong in Git.
Generated build and test output does not belong in Git.

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
| Browser timeout | `COMICCRAWLER_BROWSER_CONNECT_TIMEOUT` | `30000` |
| Browser network exposure | `COMICCRAWLER_BROWSER_EXPOSE_NETWORK` | unset |
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

## 6. Browser Provider development

Build the SDK:

```bash
npm run build:browser-provider-sdk
```

The client performs these actions:

1. Reads the discovery document.
2. Opens an outbound control connection.
3. Starts a temporary browser profile.
4. Relays Playwright traffic.

ComicCrawler never launches Chromium in the backend process.

See [Browser Provider SDK](../browser-provider-sdk/README.md) for full CLI usage.

## 7. Verification gates

### 7.1 Development launcher

Use this gate for launcher or port changes:

```bash
npm run test:dev
```

### 7.2 Daily gate

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

### 7.3 Full local gate

Use this gate for browser and WebUI flows:

```bash
npm run verify:local
```

It performs these checks:

1. Runs `verify:quick`.
2. Starts Playwright Service.
3. Starts the E2E Browser Provider.
4. Runs the Playwright suite.

### 7.4 Focused gates

```bash
npm run test:api
npm run -w backend test:coverage -- --runInBand
npm run -w frontend test:coverage -- --runInBand
npm run -w browser-provider-sdk test:coverage
```

See the outer [test strategy](../../docs/TDD.md) for the current coverage
baseline.

## 8. Troubleshooting

### 8.1 Frontend returns HTTP 502

Check the terminal in this order:

1. Find the backend readiness message.
2. Inspect earlier backend errors.
3. Confirm the configured backend port.
4. Confirm the frontend API target.

The frontend proxy requires a reachable backend.

### 8.2 A port is unavailable

Follow these steps:

1. Remove explicit port overrides.
2. Start `npm run dev` again.
3. Read the printed frontend URL.

Set a different backend port when required:

```powershell
$env:COMICCRAWLER_PORT = "4200"
npm run dev
```

### 8.3 Tests do not exit

Use Jest handle detection:

```bash
npm run -w frontend test -- --runInBand --detectOpenHandles
```

Check these resources:

1. WebSocket connections.
2. Timers.
3. Pending HTTP requests.
4. Mounted React effects.

## 9. Development references

- [Contributing](../CONTRIBUTING.md)
- [Architecture](ARCHITECTURE.md)
- [Adapter development](ADAPTERS.md)
- [AO Selector Discovery](AO_SELECTOR_DISCOVERY.md)
- [Reliability](RELIABILITY.md)
- [API Reference](API.md)
