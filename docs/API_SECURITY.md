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
- Optional Browser Client and session limits.
- User IDs.
- User API tokens.

Browser Client credentials are issued by the Server. They are not stored in the
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
        "id": "browser-client-register",
        "methods": ["POST"],
        "path": "/api/browser-clients/enroll",
        "permission": "browser-client:register"
      },
      {
        "id": "browser-client-read",
        "methods": ["GET"],
        "path": "/api/browser-clients",
        "permission": "browser-client:read-own"
      },
      {
        "id": "browser-worker-list",
        "methods": ["GET"],
        "path": "/api/browser-workers",
        "permission": "browser-client:read-own"
      },
      {
        "id": "browser-client-credential-rotate",
        "methods": ["POST"],
        "path": "/api/browser-clients/:clientId/credentials/rotate",
        "permission": "browser-client:manage-own"
      },
      {
        "id": "browser-client-revoke",
        "methods": ["DELETE"],
        "path": "/api/browser-clients/:clientId",
        "permission": "browser-client:manage-own"
      },
      {
        "id": "task-browser-target-recovery",
        "methods": ["POST"],
        "path": "/api/tasks/:id/rebind-browser-target",
        "permission": "task:control-own"
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
        "browser-client:register",
        "browser-client:read-own",
        "browser-client:manage-own",
        "browser-client:session-own",
        "task:control-own"
      ],
      "limits": {
        "maxRegisteredBrowserClients": 10,
        "maxOnlineBrowserWorkers": 5,
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

## Browser Client credentials

First enrollment uses the user API token. The Server then returns a Browser Client
credential once.

The Browser Client uses that credential for its outbound command WebSocket. It
does not retain the user API token for reconnects.

Each Browser Client installation has its own credential. Revoking or rotating
one credential does not invalidate the user's other Browser Clients.

See the [Browser Client SDK guide](../browser-client-sdk/README.md) for the
consumer integration contract.

## Ownership scope

Browser Client ownership checks are implemented for listing, session control,
credential rotation, and revocation. Existing-tab task recovery implements
`task:control-own` and checks the task, Worker, and resource owner before
changing the target. Browser-backed operations accept a stable `browserTarget`;
the Server verifies visibility, reserves the Worker, and keeps the resulting
lease bound to the operation.

Other resource-specific `*-own` permissions remain denied until their resource
models store an owner. Use their non-`own` permission only when cross-user
access is acceptable.

## WebUI authentication boundary

Token mode is available to REST clients and the Browser Client SDK. The WebUI
does not provide sign-in or attach user authentication headers. Use public mode
for direct WebUI access, or place an authenticated client/proxy in front of it.

## Secret handling

- Use HTTPS and WSS outside a trusted local network.
- Do not place tokens in URLs.
- Keep the secret document outside the normal data directory.
- Protect persisted Browser Client credential state.
- Do not log `Authorization`, token, or credential values.
- Rotate a Browser Client credential if its state is copied or exposed.
