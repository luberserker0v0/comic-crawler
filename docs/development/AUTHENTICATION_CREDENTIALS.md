# Authentication and Credentials

## 1. Credential types

| Value | Issuer | Holder | Purpose |
|---|---|---|---|
| User ID | Operator | REST client | Selects the account in token mode. |
| User API token | Operator | REST client | Authenticates enrollment and REST calls. |
| Client ID | Server | Browser Client state | Identifies one enrolled installation. |
| Client credential | Server | Browser Client state | Authenticates the outbound command WebSocket. |
| Worker ID | Server | Live Client process | Selects one current connection. |
| Process instance ID | SDK | Live Client process | Preserves reconnect affinity for that process. |
| Session ID | Server | Server and Client | Identifies one task-scoped browser session. |
| Lease ID | Server | Server and Client | Prevents cross-task command reuse. |

## 2. Enrollment

1. Read Browser Client discovery.
2. Send Client capabilities.
3. Include user credentials in token mode.
4. Receive Client ID and credential once.
5. Persist the response through `ClientStateStore`.

The Server stores only a hash of the Client credential.

## 3. Connection

1. Open the command WebSocket.
2. Send authentication as the first frame.
3. Include Client ID and Client credential.
4. Include the process instance ID.
5. Receive the Worker ID.
6. Start heartbeat frames.

The user API token is not used for reconnecting the Browser Client.

## 4. Rotation and revocation

1. Authenticate the REST request as the owner or administrator.
2. Rotate or revoke the selected Client ID.
3. Disconnect all Workers for that Client.
4. Persist the replacement credential after rotation.
5. Re-enroll after revocation when access is still desired.

## 5. Handling rules

- Never place a token or credential in a URL.
- Never write credentials to application logs.
- Use HTTPS and WSS outside trusted local networks.
- Keep the Server secret document outside normal runtime data.
- Treat persisted Client state as a secret.
- Do not infer roles or permissions from Client-supplied values.
