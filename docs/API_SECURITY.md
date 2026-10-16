# API security

ComicCrawler supports two API security modes:

- `public`: no user token is required.
- `token`: REST access is controlled by users, roles, permissions, and policy
  rules.

The default is `public`. Use `token` for an Internet-facing or shared Server.

## Objects

The policy is normal, non-secret configuration. It maps an HTTP method and path
to one permission.

The secret document contains:

- Roles and their permissions.
- Optional Provider and session limits.
- User IDs.
- User API tokens.

Provider credentials are issued by the Server. They are not stored in the
secret document.

## Token mode setup

Perform the initial policy update while the Server is still in `public` mode.
Send the complete `apiSecurity` object to `PUT /api/config`:

```json
{
  "apiSecurity": {
    "mode": "token",
    "defaultEffect": "deny",
    "secretPath": "/run/secrets/comiccrawler-api-security.json",
    "rules": [
      {
        "id": "provider-register",
        "methods": ["POST"],
        "path": "/api/browser-providers/enroll",
        "permission": "browser-provider:register"
      },
      {
        "id": "provider-read",
        "methods": ["GET"],
        "path": "/api/browser-providers",
        "permission": "browser-provider:read-own"
      },
      {
        "id": "browser-worker-list",
        "methods": ["GET"],
        "path": "/api/browser-workers",
        "permission": "browser-provider:read-own"
      },
      {
        "id": "provider-credential-rotate",
        "methods": ["POST"],
        "path": "/api/browser-providers/:providerId/credentials/rotate",
        "permission": "browser-provider:manage-own"
      },
      {
        "id": "provider-revoke",
        "methods": ["DELETE"],
        "path": "/api/browser-providers/:providerId",
        "permission": "browser-provider:manage-own"
      }
    ]
  }
}
```

Add separate rules for every other API that should remain accessible. Token
mode denies an API route when no rule matches it.

Create the secret file outside the ComicCrawler data directory:

```json
{
  "schemaVersion": 1,
  "roles": [
    {
      "id": "browser-user",
      "permissions": [
        "browser-provider:register",
        "browser-provider:read-own",
        "browser-provider:manage-own",
        "browser-provider:session-own"
      ],
      "limits": {
        "maxRegisteredProviders": 10,
        "maxOnlineProviders": 5,
        "maxConcurrentSessions": 3
      }
    }
  ],
  "users": [
    {
      "id": "alice",
      "token": "replace-with-at-least-32-random-characters",
      "roles": ["browser-user"],
      "enabled": true
    }
  ]
}
```

Restart the Server after mounting the secret. Token mode fails startup when the
secret is missing or invalid. It never falls back to public mode.

Environment variables may override the stored mode and secret path:

```text
COMICCRAWLER_API_SECURITY_MODE=token
COMICCRAWLER_API_SECURITY_SECRET_PATH=/run/secrets/comiccrawler-api-security.json
```

For Docker Compose, mount the secret with a local override:

```yaml
services:
  app:
    environment:
      COMICCRAWLER_API_SECURITY_MODE: token
      COMICCRAWLER_API_SECURITY_SECRET_PATH: /run/secrets/comiccrawler-api-security.json
    volumes:
      - ./secrets/api-security.json:/run/secrets/comiccrawler-api-security.json:ro
```

## REST authentication

Token-mode REST requests provide both headers:

```http
X-ComicCrawler-User-Id: alice
Authorization: Bearer <user-api-token>
```

The Server resolves roles and permissions. Client-supplied role or permission
values are ignored.

## Browser Provider credentials

First registration uses the user API token. The Server then returns a Provider
credential once.

The Browser Provider uses that credential for control and relay WebSockets. It
does not retain the user API token for reconnects.

Each Provider instance has its own credential. Revoking or rotating one
credential does not invalidate the user's other Provider instances.

See the [Browser Provider SDK guide](../browser-provider-sdk/README.md) for the
client configuration and command.

## Current ownership scope

Provider ownership checks are implemented for listing, session control,
credential rotation, and revocation.

Other resource-specific `*-own` permissions remain denied until their resource
models store an owner. Use their non-`own` permission only when cross-user
access is acceptable.

## Current integration limits

- Crawler and selector-discovery jobs persist their selected session and reject
  silent failover. Interactive Adapter Lab operations and verification handoff
  still need an explicit session-selection contract.
- Token mode is available to REST clients and the Browser Provider SDK. The
  current WebUI does not yet provide sign-in or attach the user authentication
  headers, so use public mode for the WebUI until that client integration is
  implemented.

## Secret handling

- Use HTTPS and WSS outside a trusted local network.
- Do not place tokens in URLs.
- Keep the secret document outside the normal data directory.
- Keep Provider state and credential files separate.
- Do not log `Authorization`, token, or credential values.
- Rotate a Provider credential if its credential file is copied or exposed.
