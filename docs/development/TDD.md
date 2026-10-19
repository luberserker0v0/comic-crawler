# Software Test Design

本文件承擔 Software Test Design 文件角色。專案不另外維護 `STD.md`。
高階案例與步驟集中在 `TEST_SCENARIOS.md`。

## 1. Test layers

### Unit tests

1. Validate protocol messages.
2. Validate Client credential storage.
3. Validate Worker registration.
4. Validate lease exclusivity.
5. Validate resource ownership.
6. Validate exact URL adoption.
7. Validate render command ordering.
8. Validate Profile cleanup.
9. Validate adapter extraction.
10. Validate scheduler policies.
11. Validate bounded content preparation.
12. Validate virtualized image annotations.
13. Validate incomplete DOM rejection.
14. Validate verified session reuse.
15. Validate draft runtime isolation.

### Integration tests

1. Start an in-process Server.
2. Enroll a Browser Client.
3. Connect through WebSocket.
4. Register one browser resource.
5. Open one browser session.
6. Execute page commands.
7. Reject active resource revocation.
8. Close the session.
9. Revoke the resource.
10. Verify Worker availability.

### Functional tests

1. Create a crawl task.
2. Select an online Worker.
3. Render chapter DOM.
4. Extract every image URL.
5. Download expected images.
6. Verify task result.

### E2E tests

1. Build all workspaces.
2. Start the production Server.
3. Start a Browser Client fixture.
4. Open the WebUI.
5. Create a task.
6. Complete verification when required.
7. Resume the same task.
8. Verify output and previews.

## 2. Browser Client contract cases

1. Reject a non-authentication first frame.
2. Reject an invalid Client credential.
3. Reject a disabled owner.
4. Reject unsupported protocol versions.
5. Reject a duplicate live process.
6. Keep a stable Worker ID on process reconnect.
7. Reject a second concurrent session.
8. Reject commands with a wrong lease.
9. Fail pending commands after disconnect.
10. Close stale heartbeat connections.
11. Reject resource registration from managed-profile Workers.
12. Reject resource access across Workers.
13. Reject an existing tab with a mismatched URL.
14. Reject revocation while a resource is leased.
15. Preserve the WebSocket after resource rejection.
16. Re-register resources after process reconnect.
17. Preserve user-owned tabs after session close.
18. Delete session-owned Profiles after session close.
19. Delete partial copies after provisioning failure.
20. Run the exported Executor contract harness in any test runner.
21. Preserve loaded URLs from virtualized reader pages.
22. Reject an aborted command before browser access.
23. Rebind a task only to an explicitly supplied resource.
24. Reject stale, cross-owner, mismatched URL, and invalid-state recovery.
25. Preserve recovery events and handoff history.
26. Treat an identical recovery request as idempotent.

## 3. Traceability

`TEST_SCENARIOS.md` 是案例定義。下表記錄主要自動化落點；一個測試檔可覆蓋
多個案例。

| Test file | Primary scenario IDs |
|---|---|
| `backend/tests/unit/browser/browser-render-service.test.ts` | BC-03, BC-15 |
| `backend/tests/unit/browser/browser-worker-lease-coordinator.test.ts` | BC-17, BC-18 |
| `backend/tests/unit/challenge/browser-worker-handoff.test.ts` | BC-05, BC-14 |
| `backend/tests/unit/server/task-routes.test.ts` | TASK-01～03, BC-17～19 |
| `backend/tests/integration/browser-target-recovery.test.ts` | BC-17, BC-18 |
| `backend/tests-e2e/api.test.ts` | BC-04, BC-05, BC-17, REL-01, REL-02 |
| `backend/tests/unit/server/adapter-routes.test.ts` | ADP-01～06, BC-14 |
| `backend/tests/unit/server/adapter-draft-routes.test.ts` | ADP-03, ADP-04, ADP-07 |
| `backend/tests/unit/server/selector-discovery-routes.test.ts` | DISC-02～04, DISC-08 |
| `backend/tests/unit/adapter/sites/comix/adapter.test.ts` | COMIX-01 |
| `backend/tests/unit/fixtures/dom-readiness.test.ts` | ADP-06, BC-15 |
| `browser-client-sdk/tests/webextension-driver.test.ts` | BC-06, BC-15, BC-16 |

正式環境 Consumer 驗證對應 BC-13 與 COMIX-02。它不是 merge gate，因為外部
網站與 challenge 狀態不穩定。

## 4. Test commands

Run commands from `repo/`.

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:all
```

- `test:unit` runs Backend, Frontend, and Browser Client SDK unit tests.
- `test:integration` runs Backend and Frontend integration tests.
- `test:e2e` runs every configured Playwright project.
- `test:all` runs all non-E2E suites, then Playwright E2E.
- `test:e2e:chromium` runs only the Chromium project.

Use the suffixed commands to narrow the target:

```bash
npm run test:unit:backend
npm run test:unit:frontend
npm run test:unit:browser-client-sdk
npm run test:integration:backend
npm run test:integration:frontend
```

## 5. Merge gates

Run from `repo/`:

```bash
npm run typecheck
npm run lint
npm run test:all
npm run build
npm run verify:utf8
```

Run the browser E2E suite when command protocol, handoff, viewport, or WebUI
task creation changes.

Run the production acceptance consumer against a deployed Server before a
Browser Client protocol release.
