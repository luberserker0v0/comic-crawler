# Browser Client Production Acceptance Consumer

This first-party test Consumer connects the real Browser Client SDK to a real
Chrome process. It is a developer acceptance tool, not a Server component or a
user-facing GUI.

It validates the `managed-profile` production path:

1. Discover the deployed Server.
2. Enroll with the configured API security policy.
3. Save the issued Client credential locally.
4. Open the production command WebSocket.
5. Advertise a managed-profile Worker.
6. Launch headed Chrome when a task is assigned.
7. Execute the real page command protocol.
8. Reconnect after a transport interruption.
9. Remove the temporary Profile after the session.

## Setup

Run from `repo/`:

```powershell
npm install
Copy-Item tools/browser-client-acceptance/config.example.json tools/browser-client-acceptance/config.json
```

Edit `config.json` and set `serverUrl`. The default Profile mode is `fresh`.

## Enroll

Public Server:

```bash
npm run acceptance:browser-client -- enroll --config tools/browser-client-acceptance/config.json
```

Token-protected Server:

```powershell
$env:COMICCRAWLER_USER_ID = 'alice'
$env:COMICCRAWLER_USER_TOKEN = '<user-api-token>'
npm run acceptance:browser-client -- enroll --config tools/browser-client-acceptance/config.json
```

The enrollment response is written to `statePath`. `--state <path>` overrides
that location. The credential is never printed.

## Connect

```bash
npm run acceptance:browser-client -- connect --config tools/browser-client-acceptance/config.json
```

The command prints the Worker ID. Select that Worker when creating a
`managed-profile` task in WebUI or REST. Press `Ctrl+C` after the task finishes.

## Copy Profile mode

Close Chrome before using copy mode:

```json
{
  "type": "copy",
  "sourceUserDataRoot": "C:/Users/name/AppData/Local/Google/Chrome/User Data",
  "sourceProfile": "Default"
}
```

The Consumer copies the Profile to a temporary directory. It excludes cache and
lock files, preserves `Local State`, and deletes the copy after the session.
Copy failure does not fall back to a fresh Profile.

## Boundary

This CLI cannot adopt a tab from an already-open Chrome window. Production
acceptance for `existing-tab` requires a WebExtension Consumer using the same
SDK contract.
