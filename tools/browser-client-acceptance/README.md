# Browser Client Production Acceptance Consumer

This first-party test Consumer connects the real Browser Client SDK to a real
Chrome process. It is a developer acceptance tool, not a Server component or a
user-facing GUI.

It validates both production execution paths:

1. Discover the deployed Server.
2. Enroll with the configured API security policy.
3. Save the issued Client credential locally.
4. Open the production command WebSocket.
5. Advertise the configured Worker mode.
6. Execute the real page command protocol.
7. Reconnect after a transport interruption.
8. Clean up its owned browser and Profile.

## Test boundary

The Consumer owns the Chrome process used by these tests. It does not attach to
an unrelated Chrome process. Both modes still use the production SDK, WebSocket,
Server scheduler, Adapter Lab, and adapter runtime.

Use a separate config and `statePath` for each execution mode. This keeps each
enrolled Client identity and its registered capabilities unambiguous.

## Common setup

Run from `repo/`:

```powershell
npm install
```

Create one config per mode:

```powershell
Copy-Item tools/browser-client-acceptance/config.example.json tools/browser-client-acceptance/existing-tab.json
Copy-Item tools/browser-client-acceptance/config.example.json tools/browser-client-acceptance/managed-profile.json
```

Set these values in `existing-tab.json`:

```json
{
  "clientName": "acceptance-existing-tab",
  "executionMode": "existing-tab",
  "statePath": ".state/existing-tab.json"
}
```

Set these values in `managed-profile.json`:

```json
{
  "clientName": "acceptance-managed-profile",
  "executionMode": "managed-profile",
  "statePath": ".state/managed-profile.json"
}
```

Keep the remaining `browser` fields from the example. Set `serverUrl` to the
deployed ComicCrawler Server.

## Enroll a test Client

Public Server:

```bash
npm run acceptance:browser-client -- enroll --config tools/browser-client-acceptance/existing-tab.json
npm run acceptance:browser-client -- enroll --config tools/browser-client-acceptance/managed-profile.json
```

Token-protected Server:

```powershell
$env:COMICCRAWLER_USER_ID = 'alice'
$env:COMICCRAWLER_USER_TOKEN = '<user-api-token>'
npm run acceptance:browser-client -- enroll --config tools/browser-client-acceptance/existing-tab.json
npm run acceptance:browser-client -- enroll --config tools/browser-client-acceptance/managed-profile.json
```

Each response is written to its configured `statePath`. The credential is never
printed.

## Test `existing-tab`

```bash
npm run acceptance:browser-client -- connect --config tools/browser-client-acceptance/existing-tab.json
```

### Connect and register a tab

1. Wait for `Browser Worker online`.
2. Wait for the owned Chrome window.
3. Open the target chapter in that Chrome.
4. Wait for `Tab registered`.

### Run the adapter

1. Open Adapter Lab.
2. Enter the same chapter URL.
3. Select the existing-tab option.
4. Run a browser-backed adapter function.
5. Check the returned adapter result.

Expected results:

- The selected tab title and URL appear in Adapter Lab.
- Running the adapter does not open another browser.
- The task uses the selected `workerId + resourceId`.
- The original tab remains open after the session.
- Closing the tab removes its target from Adapter Lab.

The Consumer registers every HTTP(S) tab in its owned Chrome. Navigation updates
the resource. Closing a tab revokes it. A task session adopts the selected tab
and does not close it.

## Test `managed-profile`

```bash
npm run acceptance:browser-client -- connect --config tools/browser-client-acceptance/managed-profile.json
```

### Connect the Worker

1. Wait for `Browser Worker online`.
2. Confirm that Chrome has not opened.

### Run the adapter

1. Open Adapter Lab.
2. Enter the target chapter URL.
3. Select the managed-profile Worker.
4. Run a browser-backed adapter function.
5. Wait for the owned Chrome window.
6. Check the returned adapter result.

### Verify handoff

1. Run a page that requires verification.
2. Complete verification in the same Chrome.
3. Continue the Adapter Lab test.
4. Check the returned adapter result.

Expected results:

- Adapter Lab lists the Worker without a tab resource.
- Chrome opens only after task assignment.
- Chrome navigates to the requested URL.
- Handoff keeps the same browser session.
- Session completion closes the owned Chrome context.
- Temporary Profile cleanup runs after session closure.

## Stop the Consumer

1. Finish or cancel the active test.
2. Return to the Consumer terminal.
3. Press `Ctrl+C`.
4. Wait for cleanup to finish.

Do not close the terminal while a task is still using its browser session.

## Troubleshooting

If an existing tab is missing:

1. Confirm that the Worker is online and idle.
2. Confirm that `Tab registered` was printed.
3. Confirm that both URLs refer to the same page.
4. Refresh the Adapter Lab browser targets.

If a managed Worker is missing:

1. Confirm that its config uses `managed-profile`.
2. Confirm that `Browser Worker online` was printed.
3. Confirm that no other task holds the Worker.

If verification appears:

1. Complete it in the owned Chrome window.
2. Keep that browser window open.
3. Return to Adapter Lab.
4. Continue the existing handoff test.

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

A production Browser Client may obtain an approved tab through its platform API.
It uses the same SDK contract exercised by this acceptance Consumer.
