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
16. Validate stable chapter and page identities.
17. Validate reorder, insertion, removal, and URL renewal.
18. Validate source replacement fingerprint behavior.
19. Preserve handoff owner, URL, and exact browser target.
20. Finish deferred handoffs as failed or cancelled.
21. Prefer usable reader DOM over passive challenge scripts.
22. Preserve runtime data during development cleanup.
23. Preserve immutable adapter package versions.
24. Activate, deactivate, restore, and roll back catalog versions.
25. Inspect a shared package without executing it.
26. Reject schema, checksum, and identity mismatches.
27. Import shared packages inactive by default.
28. Activate imported packages only when explicitly requested.
29. Verify registry indexes with administrator-trusted Ed25519 keys.
30. Reject modified indexes, packages, identities, checksums, and key IDs.
31. Install signed remote packages inactive by default.
32. Reject registry redirects, private networks, and oversized responses.
33. Produce deterministic signed registry artifacts from reviewed packages.
34. Reject duplicate identities and non-Ed25519 release keys.
35. Keep private signing keys out of generated registry artifacts.
36. Derive the published public key from the configured release private key.
37. Keep signing jobs separate from Pages deployment permissions.
38. Build project-source adapters only when the Catalog sandbox can load them.
39. Validate every checked-in Registry source package.
40. Verify Adapter build-job deletion preserves promoted Catalog packages and approved fixtures.
41. Verify approved fixtures use version-owned storage and replay the exact immutable Adapter version.
42. Verify maintenance skips active and awaiting-review Adapter build jobs.
43. Resolve a chapter-only Adapter through inspect mode without requiring metadata.
44. List only the requesting user's process-scoped browser resources.
45. Select only idle Browser targets registered for the exact test URL.
46. Forward adapter reader selectors to `page.prepare.start`.
47. Stop before infinite page content after dynamic reader pages stabilize.
48. Stop fallback after 60 growing-document steps.
49. Reject explicit reader selectors that match no pages.
50. Keep AO stage prompts isolated and free of retry history.
51. Abort running scheduler work when a task is cancelled.
52. Forward task cancellation to the active Browser Client command.
53. Keep the browser session usable after command cancellation.
54. Cancel retained challenge leases with waiting-verification tasks.
55. Abort direct chapter-image extraction after an HTTP disconnect.
56. Restore reader positions before releasing a cancelled browser session.
57. Restore window and nested positions after successful preparation.
58. Continue reader preparation across bounded command steps.
59. Preserve captured URLs and cursor progress between steps.
60. Reset the no-progress timer only when progress changes.
61. Finish active preparation once when a session closes.
62. Persist owner-scoped chapter manifests across service restarts.
63. Keep manifest revisions stable when semantic content is unchanged.
64. Resolve renewed signed URLs without exposing internal matching keys.
65. Report duplicate URL matches as ambiguous unless input occurrences disambiguate them.
66. Require an Adapter ID when multiple manifests match one chapter URL.

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
11. Repeat Dynamic/Playwright chapter extraction.
12. Preserve IDs across renewed and reordered URLs.
13. Reuse one verified handoff for chapter-images retry.
14. Persist only a successful complete chapter extraction.
15. Read the manifest after restart without Adapter or Browser Client access.
16. Return `404` for missing manifests without live fallback.

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
27. Report locally closed managed browser sessions.
28. Close orphan sessions after Server identity changes.
29. Wait for dynamically created reader pages.
30. Resume Adapter Lab handoff without an idle target.
31. Register an acceptance-browser tab for Adapter Lab selection.
32. Cancel an active command through the Server WebSocket.
33. Ignore late completion events after task cancellation.

## 3. Traceability

`TEST_SCENARIOS.md` 是案例定義。下表記錄主要自動化落點；一個測試檔可覆蓋
多個案例。

| Test file | Primary scenario IDs |
|---|---|
| `backend/tests/unit/browser/browser-render-service.test.ts` | BC-03, BC-15, BC-27, BC-28 |
| `backend/tests/unit/browser/browser-session-gateway.test.ts` | BC-03, BC-26 |
| `backend/tests/unit/browser/browser-worker-lease-coordinator.test.ts` | BC-17, BC-18, BC-20 |
| `backend/tests/unit/challenge/browser-worker-handoff.test.ts` | BC-05, BC-14, ADP-10, ADP-12, ADP-13 |
| `backend/tests/unit/server/task-routes.test.ts` | TASK-01～04, BC-17～19 |
| `backend/tests/unit/task/manager.test.ts` | TASK-04, ADP-13 |
| `backend/tests/unit/scheduler/task-scheduler-lifecycle.test.ts` | TASK-04 |
| `backend/tests/integration/browser-target-recovery.test.ts` | BC-17, BC-18 |
| `backend/tests-e2e/api.test.ts` | BC-04, BC-05, BC-17, REL-01, REL-02 |
| `backend/tests/unit/server/adapter-routes.test.ts` | ADP-01～06, BC-14, BC-23 |
| `backend/tests/unit/server/adapter-draft-routes.test.ts` | ADP-03, ADP-04, ADP-07 |
| `backend/tests/unit/adapter/chapter-image-identity.test.ts` | ADP-08, ADP-09 |
| `backend/tests/unit/adapter/catalog.test.ts` | ADP-14～17 |
| `backend/tests/unit/adapter/package-transfer.test.ts` | ADP-18～21 |
| `backend/tests/unit/adapter/registry-sources.test.ts` | ADP-23 |
| `backend/tests/unit/cli/adapter-package-command.test.ts` | ADP-18, ADP-20, ADP-22 |
| `backend/tests/integration/chapter-image-identities.test.ts` | ADP-08 |
| `backend/tests/unit/server/selector-discovery-routes.test.ts` | DISC-02～04, DISC-08 |
| `backend/tests/unit/adapter/sites/comix/adapter.test.ts` | COMIX-01, COMIX-03 |
| `backend/tests/integration/chapter-images-handoff.test.ts` | ADP-10, ADP-11 |
| `backend/tests/integration/chapter-images-request-cancellation.test.ts` | BC-26 |
| `backend/tests/unit/adapter/chapter-image-manifest.test.ts` | ADP-24～27 |
| `backend/tests/integration/chapter-image-manifests.test.ts` | ADP-24～26 |
| `backend/tests/unit/fixtures/dom-readiness.test.ts` | ADP-06, BC-15 |
| `browser-client-sdk/tests/browser-client.test.ts` | BC-20, BC-21, BC-26 |
| `browser-client-sdk/tests/content-preparation.test.ts` | BC-25, BC-27 |
| `browser-client-sdk/tests/executors.test.ts` | BC-06, BC-15, BC-16, BC-27, BC-28 |
| `browser-client-sdk/tests/playwright-runtime.test.ts` | BC-16, BC-22, BC-26 |
| `frontend/tests/unit/pages/browser-target-options.test.ts` | BC-23 |
| `tools/browser-client-acceptance/tests/existing-tab-runtime.test.mjs` | BC-24 |
| `scripts/clean.test.mjs` | DEV-01, DEV-02 |

正式環境 Consumer 驗證對應 BC-13、BC-24 與 COMIX-02。它不是 merge gate，
因為外部網站與 challenge 狀態不穩定。

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
- `test:browser-client-acceptance` runs the automated Consumer checks.

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
