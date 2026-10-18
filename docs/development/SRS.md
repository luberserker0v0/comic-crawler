# Software Requirements Specification

## 1. Scope

ComicCrawler is an adapter-based crawling service. The Server owns REST APIs,
task scheduling, adapter execution, fixtures, downloads, and durable state. A
user-side Browser Client owns browser access and connects to the Server through
one outbound command WebSocket.

## 2. Actors

| Actor | Responsibility |
|---|---|
| User | Creates tasks and completes human verification. |
| REST or WebUI client | Calls Server APIs and selects a Browser Worker. |
| Browser Client consumer | Embeds the SDK and implements browser commands. |
| ComicCrawler Server | Authorizes, schedules, extracts, and downloads. |
| Developer | Reviews adapters and accepts fixture-backed results. |

## 3. Browser requirements

- **BRW-001**: The user device must only require outbound network access.
- **BRW-002**: The Server must expose Browser Client discovery and enrollment APIs.
- **BRW-003**: Enrollment must issue a revocable Client credential once.
- **BRW-004**: A live Client process must create a selectable Worker identity.
- **BRW-005**: One Worker must execute at most one task at a time.
- **BRW-006**: A task may target any Worker or one visible Worker ID.
- **BRW-007**: A specific Worker must never be silently replaced.
- **BRW-008**: Busy tasks must wait until their configured timeout.
- **BRW-009**: Handoff must retain the task's Worker and browser session.
- **BRW-010**: Reconnect affinity is guaranteed only while the Client process lives.
- **BRW-011**: The protocol must not proxy arbitrary Playwright methods.
- **BRW-012**: Browser file transfer is outside the protocol.

## 4. Task requirements

- **TSK-001**: Crawl and adapter jobs must run through a scheduler policy.
- **TSK-002**: Scheduler policy must support sequential and concurrent strategies.
- **TSK-003**: Task creation must persist owner and Browser Worker target.
- **TSK-004**: Rendered DOM must come from the task-bound Worker session.
- **TSK-005**: Human verification must move the task into a resumable state.
- **TSK-006**: Resume must continue from the saved checkpoint.

## 5. Adapter requirements

- **ADP-001**: Runtime adapters must declare explicit capabilities.
- **ADP-002**: DOM acquisition uses the single `playwright` strategy name.
- **ADP-003**: Chapter-image APIs must return the full ordered URL list.
- **ADP-004**: Generated adapters require developer review before promotion.
- **ADP-005**: Promotion must capture page HTML and expected output as a fixture.
- **ADP-006**: Fixture capture failure must prevent promotion.
- **ADP-007**: Adapter Lab must execute editable project and generated drafts.

## 6. Security requirements

- **SEC-001**: API mode must be either `public` or `token`.
- **SEC-002**: Token mode must authenticate user ID and user API token.
- **SEC-003**: Roles must resolve permissions and optional limits Server-side.
- **SEC-004**: Browser Client credential must be distinct from the user API token.
- **SEC-005**: Credential rotation or revocation must disconnect affected Workers.
- **SEC-006**: Credentials must not appear in URLs or logs.

## 7. Quality requirements

- **QLT-001**: Backend defaults to `127.0.0.1:4100`.
- **QLT-002**: Container health checks must use `/api/status`.
- **QLT-003**: Text files must be UTF-8 with LF endings.
- **QLT-004**: Unit, integration, contract, and E2E layers must be documented.
- **QLT-005**: OpenAPI and user documentation must describe production behavior.
