# Software Design Description

## 1. System context

```mermaid
flowchart LR
  User[User] --> UI[WebUI / REST consumer]
  UI --> API[ComicCrawler API]

  subgraph Server[ComicCrawler Server]
    API --> Scheduler[Task Scheduler]
    Scheduler --> Runtime[Crawler / Adapter Runtime]
    API --> Registry[Browser Client Registry]
    Registry --> Gateway[Browser Session Gateway]
    Scheduler --> Lease[Browser Worker Lease Coordinator]
    Lease --> Gateway
    Runtime --> Render[Browser Render Service]
    Render --> Gateway
    Runtime --> Store[Runtime State / Fixtures / Downloads]
    Runtime --> Catalog[Adapter Catalog]
  end

  subgraph Device[User Device]
    App[Browser Client]
    SDK[Browser Client SDK]
    Executor[DriverBrowserExecutor]
    Acquisition[Page Acquisition Strategy]
    Driver[BrowserPageDriver]
    Browser[User Browser / Tab]
    App --> SDK
    SDK --> Executor
    Executor --> Acquisition --> Browser
    Executor --> Driver --> Browser
  end

  SDK -->|outbound command WebSocket| Gateway
  Browser --> Sites[Comic Sites]
  Runtime -->|image URL downloads| Sites
```

The Server orchestrates work but never opens a browser. The consumer owns its
browser lifecycle. The command protocol returns rendered DOM and navigation
state; it does not expose arbitrary Playwright operations.

## 2. Component responsibilities

| Component | Responsibility |
|---|---|
| Browser Client Registry | Persists Client identity and credential hash. |
| Browser Session Gateway | Authenticates sockets and routes session commands. |
| Worker Lease Coordinator | Reserves one Worker for one task. |
| Browser Render Service | Composes navigation, readiness, and DOM commands. |
| Task Scheduler | Orders crawl and adapter jobs by policy. |
| Crawler Engine | Runs adapters and downloads image URLs. |
| Selector Discovery | Produces reviewable adapter drafts. |
| Adapter Catalog | Stores immutable approved packages and active versions. |
| Challenge Discovery | Retains the session for human verification. |
| Browser Client SDK | Implements enrollment, connection, heartbeat, and dispatch. |
| DriverBrowserExecutor | Shared session and semantic command implementation. |
| Page Acquisition Strategy | Selects a registered tab or creates a managed page. |
| BrowserPageDriver | Maps shared page commands to the Consumer runtime. |

## 3. Server class relationships

```mermaid
classDiagram
  class BrowserClientRegistry
  class BrowserSessionGateway
  class BrowserWorkerLeaseCoordinator
  class BrowserRenderService
  class TaskScheduler
  class CrawlerEngine
  class SelectorDiscoveryService
  class ChallengeDiscoveryService
  class AdapterCatalog

  BrowserSessionGateway --> BrowserClientRegistry
  BrowserWorkerLeaseCoordinator --> BrowserSessionGateway
  BrowserRenderService --> BrowserSessionGateway
  TaskScheduler --> BrowserWorkerLeaseCoordinator
  CrawlerEngine --> BrowserRenderService
  SelectorDiscoveryService --> BrowserRenderService
  ChallengeDiscoveryService --> BrowserRenderService
  SelectorDiscoveryService --> AdapterCatalog
  AdapterCatalog --> CrawlerEngine
```

## 4. Browser Client framework

```mermaid
classDiagram
  class BrowserClient {
    +enroll()
    +connect()
    +disconnect()
    +close()
  }
  class BrowserExecutor {
    <<interface>>
    +describe()
    +registerResource()
    +revokeResource()
    +openSession()
    +close()
  }
  class DriverBrowserExecutor
  class BrowserPageAcquisitionStrategy {
    <<interface>>
    +acquire()
    +close()
  }
  class ExistingTabAcquisitionStrategy
  class ManagedProfileAcquisitionStrategy
  class BrowserPageDriver {
    <<interface>>
  }
  class BrowserSession {
    <<interface>>
    +execute()
    +close()
  }
  class ClientStateStore {
    <<interface>>
    +get()
    +set()
    +clear()
  }
  class WebSocketFactory {
    <<interface>>
    +create()
  }

  BrowserClient --> BrowserExecutor
  BrowserClient --> ClientStateStore
  BrowserClient --> WebSocketFactory
  BrowserExecutor <|.. DriverBrowserExecutor
  DriverBrowserExecutor --> BrowserPageAcquisitionStrategy
  DriverBrowserExecutor --> BrowserPageDriver
  DriverBrowserExecutor --> BrowserSession
  BrowserPageAcquisitionStrategy <|.. ExistingTabAcquisitionStrategy
  BrowserPageAcquisitionStrategy <|.. ManagedProfileAcquisitionStrategy
```

The SDK has one package root and no Node, Playwright, or browser-platform runtime
dependency. Consumers inject a page driver and one acquisition strategy. Both
strategies enter the same session and command path after acquiring a page.

## 5. Protocol

The discovery path is `/.well-known/comiccrawler-browser-client`. The command
socket is `/api/browser-clients/connect`.

The first Client frame is `client.authenticate`. After authentication:

1. Existing-tab Client may send `resource.register`.
2. Server acknowledges `resource.registered`.
3. Server sends `session.open` with an explicit source.
4. Client opens its browser session.
5. Client sends `session.ready`.
6. Server sends ordered `command.execute` frames.
7. Server may send `command.cancel` for timeout or task cancellation.
8. Client sends `command.result` frames.
9. Server sends `session.close`.
10. Client releases session-owned resources.
11. Client sends `session.closed`.

Version 3 commands are:

- `page.navigate`
- `page.get-url`
- `page.get-content`
- `page.wait-for-ready`
- `page.prepare-content` with fixed `scroll-through` strategy
- `page.focus`

`ReaderPreparationCapability` declares container, page, and optional end
selectors. Browser Client owns scrolling, waiting, bounds, and position
restoration. `ChapterImagesCapability` only extracts from the prepared DOM.
Virtualized URLs remain in `data-comiccrawler-src` or
`data-comiccrawler-image-url` annotations.

Adapter Lab uses `mode: inspect` to resolve an Adapter without assuming URL path
conventions. Before a DOM-backed function runs, the UI reads Workers and
current-user browser resources. An existing-tab target is eligible only when
its registered URL equals the test URL after removing the fragment.

## 6. Identity and lifecycle

```mermaid
stateDiagram-v2
  [*] --> Enrolled
  Enrolled --> Connected: credential accepted
  Connected --> Idle: Worker created
  Idle --> Busy: lease + session open
  Busy --> Reconnecting: socket lost
  Reconnecting --> Busy: same process reconnects
  Busy --> Idle: session closed
  Reconnecting --> Offline: timeout
  Idle --> Offline: disconnect
  Offline --> [*]: process exits
```

Client ID is durable. Worker ID is tied to a Client process. Session and lease
IDs are task-scoped. Same-user simultaneous PC and mobile connections create
separate Workers without a device registry requirement.

## 7. Task flow

```mermaid
sequenceDiagram
  participant User
  participant API
  participant Scheduler
  participant Lease
  participant Gateway
  participant Client
  participant Runtime

  User->>API: create task + browserTarget
  API->>Scheduler: enqueue
  Scheduler->>Lease: acquire Worker
  Lease->>Gateway: open session
  Gateway->>Client: session.open
  Client-->>Gateway: session.ready
  Scheduler->>Runtime: execute with sessionId
  Runtime->>Gateway: render commands
  Gateway->>Client: command.execute
  Client-->>Gateway: rendered DOM
  Runtime-->>Scheduler: result / checkpoint
  Scheduler->>Lease: release
  Lease->>Gateway: close session
```

Cancellation uses the same task-scoped signal from Scheduler to Runtime. An
active browser command receives `command.cancel`. Downloads receive the same
signal. The executor then releases the lease and closes the browser session.
Cancelling `waiting_verification` also cancels the challenge job and releases
its retained lease.

Direct chapter-image extraction derives the signal from the HTTP response
connection. A caller disconnect cancels Worker acquisition or the active
command. Browser Client drains the cancelled command through bounded scroll
cleanup before acknowledging session close, preventing replacement work from
overlapping scroll restoration.

If verification is detected, Challenge Discovery retains the lease. `focus`
brings the same consumer-owned page forward. Resume detaches the retained lease
from the challenge job and continues the original task.

## 8. Scheduling

`SchedulingPolicy` is a Strategy. Sequential and concurrent policies decide
dispatch order. The Worker Lease Coordinator independently enforces one active
task per Worker and waits until timeout when no eligible Worker is idle.

## 9. Security

User API tokens authorize REST calls and enrollment. Client credentials only
authorize the Browser Client socket. The Server stores credential hashes. Every
session command is checked against Worker, session, and lease identity.

## 10. Persistence boundary

Durable Server state includes Client records, tasks, checkpoints, adapter
packages, catalog pointers, and fixtures. Approved package content is immutable.
Approved fixtures are version-owned at
`approved-fixtures/<adapterId>/<version>/<fixtureId>/`; diagnostic captures stay
under `fixtures/<domain>/<fixtureId>/` and may expire by retention policy.
Activation, rollback, and deletion update only catalog metadata. Live sockets,
Workers, leases, and sessions are process memory only.
Browser profile state belongs to the consumer and is never persisted by the
Server.
