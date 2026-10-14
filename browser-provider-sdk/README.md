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
service document advertises the current enroll endpoint, control WebSocket, and
relay WebSocket template; wrappers do not hard-code those operational paths.

## Configuration

Create a client config such as `browser-provider.json`:

```json
{
  "serverUrl": "https://crawler.example.com",
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

Use HTTPS for a remote production server. Plain HTTP is intended only for a
trusted local development connection.

## Enroll once

An administrator first creates a short-lived, one-time enrollment token:

```http
POST /api/browser-providers/enrollment-tokens
Content-Type: application/json

{ "ttlSeconds": 600 }
```

On the user machine, build the workspace and enroll the client. A token file is
recommended because an inline token can appear in the process list:

```bash
npm run build:browser-provider-sdk
npm exec -w browser-provider-sdk comiccrawler-browser-provider -- \
  enroll \
  --config ./browser-provider.json \
  --enrollment-token-file ./enrollment-token.txt \
  --state-output ./client-state.json \
  --credential-output ./client.credential
```

`--enrollment-token <token>` is also supported. ComicCrawler assigns the
`providerId`, `credentialId`, and provider display name. The enrollment command
writes non-secret state and the credential to separate files and refuses to
overwrite either output.

When output options are omitted, state is written to the OS state directory:

- Windows: `%LOCALAPPDATA%\ComicCrawler\browser-provider\provider-state.json`
- macOS: `~/Library/Application Support/ComicCrawler/browser-provider/provider-state.json`
- Linux: `$XDG_STATE_HOME/comiccrawler/browser-provider/provider-state.json`, or
  `~/.local/state/comiccrawler/browser-provider/provider-state.json`

The default credential file is `provider.credential` beside the state file.

## Connect

Start the outbound client and leave it running:

```bash
npm exec -w browser-provider-sdk comiccrawler-browser-provider -- \
  connect --config ./browser-provider.json
```

Without `--state`, connect reads the default state path used by enroll. Custom
files can be supplied explicitly:

```bash
npm exec -w browser-provider-sdk comiccrawler-browser-provider -- \
  connect \
  --config ./browser-provider.json \
  --state ./client-state.json \
  --credential ./client.credential
```

The configured server must match the server recorded during enrollment, which
prevents accidentally sending a credential to another host. The client
reconnects with bounded exponential backoff.

Useful connect overrides are `--headed`, `--headless`, `--channel`,
`--max-sessions`, and `--default-ttl`. The only environment override is
`COMICCRAWLER_BROWSER_PROVIDER_SERVER_URL`; identity and names are server-owned.

## Create and use a session

After the client is online, list providers and create the active session:

```http
GET /api/browser-providers
```

```http
POST /api/browser-providers/{providerId}/sessions
Content-Type: application/json

{
  "requestedCapabilities": { "interactive": true },
  "ttlSeconds": 1800
}
```

The active session automatically supplies the remote Playwright endpoint for
crawling, selector discovery, human-verification handoff, and browser-assisted
downloads.

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
