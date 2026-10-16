# ComicCrawler Browser Provider SDK

`@comiccrawler/browser-provider-sdk` lets a desktop GUI, browser companion, or
standalone process provide a user-side browser to ComicCrawler. The client makes
an outbound connection to ComicCrawler, so the user machine does not expose an
HTTP server or WebSocket port and works behind NAT.

The provider owns the browser process and profile. ComicCrawler requests a
short-lived Playwright session through the control connection and relays browser
traffic over additional outbound WebSocket connections. The ComicCrawler
container never launches a browser.

The SDK first reads `GET /.well-known/comiccrawler-browser-provider`. That
service document advertises the registration endpoint, control WebSocket, and
relay WebSocket template; wrappers do not hard-code those operational paths.

## Command working directory

Run the npm commands in this guide from the ComicCrawler repository root, not
from `browser-provider-sdk/`. In the complete workspace layout:

```bash
cd repo
```

Paths passed to `--config`, `--state`, and `--credential` are resolved from this
working directory unless absolute paths are used.

## Configuration

Create a client config such as `browser-provider.json`:

```json
{
  "serverUrl": "https://crawler.example.com",
  "providerName": "Alice PC",
  "authentication": {
    "userId": "alice",
    "tokenFile": "./alice.token"
  },
  "browser": {
    "headless": false,
    "channel": "chrome"
  },
  "sessions": {
    "max": 1,
    "defaultTtlSeconds": 1800
  }
}
```

Omit `authentication` when the Server uses `public` API security mode. In
`token` mode, the token file contains the user API token configured in the
Server secret document. The user token is used only for first registration;
later connections use the Provider's own credential.

Use HTTPS for a remote production server. Plain HTTP is intended only for a
trusted local development connection.

## Connect and register automatically

On the user machine, build the workspace and start the outbound client:

```bash
npm run build:browser-provider-sdk
npm exec -w browser-provider-sdk comiccrawler-browser-provider -- \
  connect --config ./browser-provider.json
```

If no Provider state exists, `connect` generates a `clientInstanceId`, registers
the Provider, writes state and credential files, and connects immediately. The
Server assigns `providerId` and `credentialId`. Existing state skips
registration and reconnects with the stored Provider credential.

When output options are omitted, state is written to the OS state directory:

- Windows: `%LOCALAPPDATA%\ComicCrawler\browser-provider\provider-state.json`
- macOS: `~/Library/Application Support/ComicCrawler/browser-provider/provider-state.json`
- Linux: `$XDG_STATE_HOME/comiccrawler/browser-provider/provider-state.json`, or
  `~/.local/state/comiccrawler/browser-provider/provider-state.json`

The default credential file is `provider.credential` beside the state file.
Custom paths can be supplied explicitly. The same paths are used for initial
output and later input:

```bash
npm exec -w browser-provider-sdk comiccrawler-browser-provider -- \
  connect \
  --config ./browser-provider.json \
  --state ./client-state.json \
  --credential ./client.credential
```

The configured server must match the server recorded during registration, which
prevents accidentally sending a credential to another host. The client
reconnects with bounded exponential backoff.

Useful connect overrides are `--headed`, `--headless`, `--channel`,
`--max-sessions`, `--default-ttl`, `--provider-name`, `--user-id`,
`--user-token-file`, and `--user-token`. Prefer a token file because an inline
token can appear in the process list. The server URL may be overridden with
`COMICCRAWLER_BROWSER_PROVIDER_SERVER_URL`.

## Select the Worker from a task

After the client is online, list the user's stable Worker targets:

```http
GET /api/browser-workers
```

```http
POST /api/tasks
Content-Type: application/json

{
  "url": "https://example.com/chapter/1",
  "mode": "chapters",
  "chapterUrls": ["https://example.com/chapter/1"],
  "browserTarget": { "mode": "specific", "workerId": "bp_..." }
}
```

The Server reserves the Worker and owns the short-lived session lifecycle. The
task API does not accept a session ID. Use `{ "mode": "any" }` when the
Scheduler may choose any idle Worker owned by the same user.

## Embedding

Applications can import `BrowserProvider`, `ReverseRelayBrowserProviderClient`,
or `PlaywrightBrowserProvider`. A wrapper may implement its own
`BrowserProvider` while using the same outbound control and relay protocol.

Browser profile lifecycle is isolated behind the abstract
`BrowserProfileStrategy`. The only production implementation is
`EphemeralProfileStrategy`: it starts a new Playwright-managed temporary
Chromium profile and reports `persistentContext: false`. Copying a user profile,
using a specified persistent profile directory, and attaching to an existing
Chrome process are intentionally not implemented.

The profile belongs to the Playwright session created for a Server-owned Worker
lease. Related operations may reuse that session, and a verification handoff
retains it so the task can resume with the same cookies and page state. Releasing
the lease, letting the session TTL expire, or stopping the Provider closes the
browser server. Playwright owns the temporary profile data; ComicCrawler does
not keep a named user-data directory or reuse it in a later session.
