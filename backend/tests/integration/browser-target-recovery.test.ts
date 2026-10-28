import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
  BrowserClient,
  type BrowserCapabilities,
  type BrowserClientSocket,
  type BrowserClientState,
  type BrowserCommand,
  type BrowserCommandResult,
  type BrowserExecutor,
  type BrowserSession,
  type ClientStateStore,
} from '@comiccrawler/browser-client-sdk';
import WebSocket, { WebSocketServer } from 'ws';
import { BrowserClientRegistry } from '../../src/browser/browser-client-registry';
import { BrowserSessionGateway } from '../../src/browser/browser-session-gateway';
import { BrowserWorkerLeaseCoordinator } from '../../src/browser/browser-worker-lease-coordinator';
import { EventBus } from '../../src/events/bus';
import type { ApiPrincipal } from '../../src/security/api-security';
import type { IStorage } from '../../src/storage/types';
import { BrowserTargetRecoveryService } from '../../src/task/browser-target-recovery-service';
import { TaskManager } from '../../src/task/manager';

const chapterUrl = 'https://example.test/chapter';
const capabilities: BrowserCapabilities = {
  executionMode: 'existing-tab',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

let server: Server;

let webSocketServer: WebSocketServer;

let gateway: BrowserSessionGateway;

let coordinator: BrowserWorkerLeaseCoordinator;

let firstClient: BrowserClient | undefined;

let secondClient: BrowserClient | undefined;

let taskManager: TaskManager;

let releaseExecutor: (() => void) | undefined;

async function startGatewayServer(): Promise<string> {
    server = createServer();
    webSocketServer = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/api/browser-clients/connect') return socket.destroy();
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => gateway.acceptConnection(webSocket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no address.');
    return `http://127.0.0.1:${address.port}`;
  }

describe('Browser Target recovery integration', () => {
  BrowserTargetRecoveryIntegrationTestGroup1();
});

function createClient(serverUrl: string, state: BrowserClientState, processInstanceId: string): BrowserClient {
  return new BrowserClient({
    serverUrl,
    executor: new ExistingTabTestExecutor(),
    stateStore: new MemoryStateStore(state),
    fetch: async () => jsonResponse({
      protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
      apiSecurityMode: 'public',
      endpoints: {
        enroll: '/api/browser-clients/enroll',
        controlWebSocket: '/api/browser-clients/connect',
      },
    }),
    webSocketFactory: {
      create: (url) => new WebSocket(url) as unknown as BrowserClientSocket,
    },
    randomUUID: () => processInstanceId,
  });
}

function enrollmentState(
  serverUrl: string,
  enrollment: { clientId: string; credentialId: string; credential: string; registeredAt: string }
): BrowserClientState {
  return {
    schemaVersion: 1,
    serverUrl: `${serverUrl}/`,
    clientId: enrollment.clientId,
    credentialId: enrollment.credentialId,
    credential: enrollment.credential,
    registeredAt: enrollment.registeredAt,
  };
}

class MemoryStateStore implements ClientStateStore {
  constructor(private readonly state: BrowserClientState) {}
  async get(): Promise<BrowserClientState> { return this.state; }
  async set(): Promise<void> {}
  async clear(): Promise<void> {}
}

class MemoryStorage implements IStorage {
  private readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T | undefined) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

class ExistingTabTestExecutor implements BrowserExecutor {
  async describe(): Promise<BrowserCapabilities> { return capabilities; }
  async openSession(): Promise<BrowserSession> { return new ExistingTabTestSession(); }
  async close(): Promise<void> {}
}

class ExistingTabTestSession implements BrowserSession {
  async execute(command: BrowserCommand): Promise<BrowserCommandResult> {
    if (command.type === 'page.get-content') {
      return { type: command.type, url: chapterUrl, html: '<main>chapter</main>' };
    }
    if (command.type === 'page.focus') return { type: command.type };
    return { type: command.type, url: command.type === 'page.navigate' ? command.url : chapterUrl };
  }
  async close(): Promise<void> {}
}

function principal(): ApiPrincipal {
  return {
    userId: 'alice',
    roles: ['user'],
    permissions: new Set(['browser-client:register', 'browser-client:session-own']),
    limits: {},
    public: false,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out while waiting for test condition.');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function BrowserTargetRecoveryIntegrationTestGroup1(): void {
  afterEach(BrowserTargetRecoveryIntegrationTestScenario1);
  it('rebinds the original task after the same Client credential starts a new process', BrowserTargetRecoveryIntegrationTestRebindsTheOriginalTaskAfterTheSameClientCredentialStartsANewProcess);
}

async function BrowserTargetRecoveryIntegrationTestScenario1() {
    releaseExecutor?.();
    await Promise.all([
        firstClient?.close().catch(() => undefined),
        secondClient?.close().catch(() => undefined),
    ]);
    await taskManager?.dispose().catch(() => undefined);
    await coordinator?.dispose().catch(() => undefined);
    gateway?.dispose();
    webSocketServer?.close();
    if (server?.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function BrowserTargetRecoveryIntegrationTestRebindsTheOriginalTaskAfterTheSameClientCredentialStartsANewProcess() {
    const original = await setupOriginalBrowserTarget();
    await createRecoverableTask(original.connection.workerId, original.resource.resourceId);
    interruptRecoveryTask();
    await firstClient!.disconnect();
    await waitFor(() => gateway.getWorker(original.connection.workerId)?.online === false);
    const replacement = await connectReplacement(original.serverUrl, original.state);
    const result = await recoverBrowserTarget(original, replacement);
    expectRecoveryResult(result, original.connection.workerId, replacement.connection.workerId,
      replacement.resource.resourceId);
}

async function setupOriginalBrowserTarget() {
    const registry = new BrowserClientRegistry();
    const enrollment = await registry.enroll(principal(), { name: 'Extension', capabilities });
    gateway = new BrowserSessionGateway(registry);
    coordinator = new BrowserWorkerLeaseCoordinator(gateway);
    const serverUrl = await startGatewayServer();
    const state = enrollmentState(serverUrl, enrollment);
    firstClient = createClient(serverUrl, state, 'extension-process-a');
    const firstConnection = await firstClient.connect();
    const firstResource = await firstClient.registerResource({ kind: 'tab', url: chapterUrl });
    return { serverUrl, state, connection: firstConnection, resource: firstResource };
}

async function createRecoverableTask(workerId: string, resourceId: string): Promise<void> {
    let executionCount = 0;
    const blocked = new Promise<void>((resolve) => { releaseExecutor = resolve; });
    taskManager = new TaskManager(async () => {
        executionCount += 1;
        if (executionCount > 1)
            await blocked;
    }, { eventBus: new EventBus(), storage: new MemoryStorage() });
    await taskManager.initialize();
    await taskManager.createTask({ id: 'task-restart-recovery', url: chapterUrl,
      adapterId: 'fixture', mode: 'chapters', chapterUrls: [chapterUrl], ownerUserId: 'alice',
      browserTarget: { mode: 'existing-tab', workerId, resourceId } });
    await waitFor(() => taskManager.getTask('task-restart-recovery')?.status === 'completed');
}

function interruptRecoveryTask(): void {
    const record = (taskManager as any).records.get('task-restart-recovery');
    record.task.status = 'interrupted';
    record.task.error = 'Browser Worker disconnected after the extension process restarted.';
    record.result.status = 'interrupted';
    record.result.error = record.task.error;
}

async function connectReplacement(serverUrl: string, state: BrowserClientState) {
    secondClient = createClient(serverUrl, state, 'extension-process-b');
    const secondConnection = await secondClient.connect();
    const secondResource = await secondClient.registerResource({ kind: 'tab', url: chapterUrl });
    return { connection: secondConnection, resource: secondResource };
}

async function recoverBrowserTarget(original: Awaited<ReturnType<typeof setupOriginalBrowserTarget>>,
  replacement: Awaited<ReturnType<typeof connectReplacement>>) {
    const recovery = new BrowserTargetRecoveryService(taskManager, coordinator);
    return recovery.recover({
        taskId: 'task-restart-recovery',
        ownerUserId: 'alice',
        expectedBrowserTarget: {
            mode: 'existing-tab',
            workerId: original.connection.workerId,
            resourceId: original.resource.resourceId,
        },
        browserTarget: {
            mode: 'existing-tab',
            workerId: replacement.connection.workerId,
            resourceId: replacement.resource.resourceId,
        },
    });
}

function expectRecoveryResult(result: { idempotent: boolean }, previousWorkerId: string,
  workerId: string, resourceId: string): void {
    expect(result.idempotent).toBe(false);
    expect(taskManager.getTask('task-restart-recovery')?.data.browserTarget).toEqual({
        mode: 'existing-tab',
        workerId, resourceId,
    });
    expect(taskManager.getEvents('task-restart-recovery')).toEqual([
        expect.objectContaining({
            type: 'task:browser_target_rebound',
            previousBrowserTarget: expect.objectContaining({ workerId: previousWorkerId }),
            browserTarget: expect.objectContaining({ workerId }),
        }),
    ]);
}
