import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { EventBus } from '../../../src/events/bus';
import { JsonFileStore } from '../../../src/storage/json-store';
import { TaskManager } from '../../../src/task/manager';
import { MaintenanceService } from '../../../src/maintenance/service';
import { SelectorDiscoveryService } from '../../../src/selector-discovery/service';
import { AdapterRegistry } from '../../../src/adapter/registry';

const TEST_ROOT = join(__dirname, '__tmp__', 'maintenance-service');

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

let storage: JsonFileStore;

let taskManager: TaskManager;

async function createCompletedTask(id: string, completedAt: Date, outputSubdir?: string): Promise<void> {
    await taskManager.createTask({ id, url: 'https://example.com/1', adapterId: 'test' });
    await flush();
    // TaskManager auto-completes with the no-op executor; backdate both timestamps.
    const task = taskManager.getTask(id);
    if (task) task.completedAt = completedAt;
    await taskManager.updateResult(id, {
      completedAt,
      ...(outputSubdir ? { outputPath: join(TEST_ROOT, 'downloads', outputSubdir) } : {}),
    });
    await flush();
  }

function stubDiscovery(jobs: Array<{ id: string; updatedAt: string; status?: string }>) {
    const normalized = jobs.map((job) => ({ status: 'failed', ...job }));
    const store = new Map(normalized.map((job) => [job.id, { ...job }]));
    return {
      list: async () => Array.from(store.values()),
      get: async (id: string) => store.get(id) ?? null,
      deleteJob: async (id: string) => store.delete(id),
    };
  }

function maintenanceService(overrides: Partial<ConstructorParameters<typeof MaintenanceService>[0]> = {}) {
  return new MaintenanceService({ storage, taskManager,
    downloadDir: join(TEST_ROOT, 'downloads'),
    getPolicy: async () => ({ enabled: true, intervalHours: 24, tasksRetainDays: 30,
      discoveryJobsRetainDays: 14, deleteFiles: true, batchLimit: 100 }),
    ...overrides,
  });
}

describe('MaintenanceService', () => {
  MaintenanceServiceTestGroup1();
});

function MaintenanceServiceTestGroup1(): void {
  beforeEach(MaintenanceServiceTestScenario1);
  afterEach(MaintenanceServiceTestScenario2);
  it('dry-run deletes nothing', MaintenanceServiceTestDryRunDeletesNothing);
  it('deletes expired tasks with files and expired discovery jobs', MaintenanceServiceTestDeletesExpiredTasksWithFilesAndExpiredDiscoveryJobs);
  it('skips discovery jobs referenced by remaining tasks', MaintenanceServiceTestSkipsDiscoveryJobsReferencedByRemainingTasks);
  it('keeps adapter jobs that still require review', MaintenanceServiceTestKeepsAdapterJobsThatStillRequireReview);
  it('deleteJob removes the implementation key without residual JSON', MaintenanceServiceTestDeleteJobRemovesTheImplementationKeyWithoutResidualJSON);
  it('cleans expired fixtures and agent sessions but keeps live adapter state', MaintenanceServiceTestCleansExpiredFixturesAndAgentSessionsButKeepsLiveAdapterState);
  it('prunes stale index entries and deletes corrupt job files via mtime fallback', MaintenanceServiceTestPrunesStaleIndexEntriesAndDeletesCorruptJobFilesViaMtimeFallback);
}

async function MaintenanceServiceTestScenario1() {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(join(TEST_ROOT, 'data'), { recursive: true });
    await fs.mkdir(join(TEST_ROOT, 'downloads', 'example'), { recursive: true });
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
    taskManager = new TaskManager(async () => { }, { eventBus: new EventBus(), storage });
    await taskManager.initialize();
}

async function MaintenanceServiceTestScenario2() {
    await taskManager.dispose().catch(() => undefined);
    await storage.dispose().catch(() => undefined);
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
}

const MAINTENANCE_SERVICE_DRY_RUN_DELETES_NOTHING_1_SOURCE = `tasks/old-task`;

async function MaintenanceServiceTestDryRunDeletesNothing() {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await createCompletedTask('old-task', old);
    const service = maintenanceService();
    const result = await service.preview();
    expect(result.dryRun).toBe(true);
    expect(result.tasks.deleted).toContain('old-task');
    expect(taskManager.getTask('old-task')).toBeDefined();
    expect(await storage.read(MAINTENANCE_SERVICE_DRY_RUN_DELETES_NOTHING_1_SOURCE)).not.toBeNull();
}

async function MaintenanceServiceTestDeletesExpiredTasksWithFilesAndExpiredDiscoveryJobs() {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const outputDir = await seedExpiredTasks(old);
    const selector = stubDiscovery([{ id: 'old-disc', updatedAt: old.toISOString() }]);
    const challenge = stubDiscovery([{ id: 'old-chal', updatedAt: old.toISOString() }]);
    const service = maintenanceService({
        selectorDiscoveryService: selector as any,
        challengeDiscoveryService: challenge as any,
        workspaceRoot: join(TEST_ROOT, 'workspaces'),
    });
    const result = await service.run();
    await expectExpiredItemsDeleted(result, outputDir);
}

async function seedExpiredTasks(old: Date): Promise<string> {
  const outputDir = join(TEST_ROOT, 'downloads', 'example', 'old-comic');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(join(outputDir, '001.jpg'), 'fake-image');
  await createCompletedTask('old-task', old, join('example', 'old-comic'));
  await createCompletedTask('recent-task', new Date());
  await taskManager.createTask({ id: 'pending-task', url: 'https://example.com/2', adapterId: 'test' });
  const pending = taskManager.getTask('pending-task');
  if (pending) Object.assign(pending, { status: 'pending', completedAt: undefined });
  await taskManager.updateResult('pending-task', { status: 'pending', completedAt: undefined });
  await flush();
  return outputDir;
}

async function expectExpiredItemsDeleted(result: Awaited<ReturnType<MaintenanceService['run']>>, outputDir: string) {
    expect(result.tasks.deleted).toContain('old-task');
    expect(result.tasks.deleted).not.toContain('recent-task');
    expect(result.tasks.deleted).not.toContain('pending-task');
    expect(taskManager.getTask('old-task')).toBeUndefined();
    await expect(fs.stat(outputDir)).rejects.toThrow();
    expect(result.discoveryJobs.deleted).toContain('old-disc');
    expect(result.discoveryJobs.deleted).toContain('old-chal');
}

async function MaintenanceServiceTestSkipsDiscoveryJobsReferencedByRemainingTasks() {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await createCompletedTask('recent-task', new Date());
    await taskManager.updateResult('recent-task', { challengeDiscoveryId: 'live-chal' });
    const challenge = stubDiscovery([{ id: 'live-chal', updatedAt: old.toISOString() }]);
    const service = maintenanceService({
        challengeDiscoveryService: challenge as any,
    });
    const result = await service.run();
    expect(result.discoveryJobs.deleted).not.toContain('live-chal');
    expect(result.discoveryJobs.skipped.join(' ')).toMatch(/referenced/);
}

async function MaintenanceServiceTestKeepsAdapterJobsThatStillRequireReview() {
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  const selector = stubDiscovery([{ id: 'review-disc', updatedAt: old.toISOString(), status: 'awaiting_review' }]);
  const result = await maintenanceService({ selectorDiscoveryService: selector as any }).run();
  expect(result.discoveryJobs.deleted).not.toContain('review-disc');
  expect(result.discoveryJobs.skipped.join(' ')).toContain('requires review or completion');
}

async function MaintenanceServiceTestDeleteJobRemovesTheImplementationKeyWithoutResidualJSON() {
    const service = new SelectorDiscoveryService(storage, new AdapterRegistry(new EventBus()));
    const job: any = { id: 'disc-1', url: 'https://example.com/', normalizedUrl: 'https://example.com/', hostname: 'example.com', status: 'awaiting_review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await storage.write('selector-discovery-job-disc-1', job);
    await storage.write('selector-discovery-index', ['disc-1']);
    await storage.write('selector-discovery-implementation-disc-1', { reviewNotesMarkdown: 'x' });
    await storage.dispose();
    expect(await service.deleteJob('disc-1')).toBe(true);
    await storage.dispose().catch(() => undefined);
    const keys = await storage.list();
    expect(keys.filter((key) => key.includes('disc-1'))).toEqual([]);
    expect(await storage.read<string[]>('selector-discovery-index')).toEqual([]);
}

async function MaintenanceServiceTestCleansExpiredFixturesAndAgentSessionsButKeepsLiveAdapterState() {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const workspaces = join(TEST_ROOT, 'workspaces');
    const paths = await seedExpiredWorkspaceFiles(workspaces, old);
    const result = await maintenanceService({ workspaceRoot: workspaces }).run();
    await expectWorkspaceCleanup(result, paths);
}

async function seedExpiredWorkspaceFiles(workspaces: string, old: Date) {
    const oldFixture = fixturePath(workspaces, '111-old'), youngFixture = fixturePath(workspaces, '999-new');
    await fs.mkdir(oldFixture, { recursive: true });
    await fs.writeFile(join(oldFixture, 'page.html'), '<html></html>');
    await fs.mkdir(youngFixture, { recursive: true });
    await fs.writeFile(join(youngFixture, 'page.html'), '<html></html>');
    await fs.utimes(oldFixture, old, old);
  const approvedFixture = await seedApprovedFixture(workspaces, old);
    const adapterDir = join(workspaces, 'kuronavi');
    await fs.mkdir(join(adapterDir, 'versions', 'v1'), { recursive: true });
    await fs.writeFile(join(adapterDir, 'session.json'), '{}');
    await fs.writeFile(join(adapterDir, 'selectors.ts'), 'export {}');
    const oldSession = join(adapterDir, 'session-111');
    const youngSession = join(adapterDir, 'session-999');
    await fs.mkdir(join(oldSession, 'attempts'), { recursive: true });
    await fs.writeFile(join(oldSession, 'error-context.json'), '{}');
    await fs.mkdir(join(youngSession, 'attempts'), { recursive: true });
    await fs.utimes(oldSession, old, old);
  return { oldFixture, youngFixture, approvedFixture, adapterDir, oldSession };
}

function fixturePath(workspaces: string, id: string): string {
  return join(workspaces, 'fixtures', 'example.com', id);
}

async function seedApprovedFixture(workspaces: string, old: Date): Promise<string> {
  const directory = join(workspaces, 'approved-fixtures', 'demo', 'v1', '222-approved');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(join(directory, 'page.html'), '<html></html>');
  await fs.utimes(directory, old, old);
  return directory;
}

async function expectWorkspaceCleanup(result: Awaited<ReturnType<MaintenanceService['run']>>,
  paths: Awaited<ReturnType<typeof seedExpiredWorkspaceFiles>>) {
    const { oldFixture, youngFixture, approvedFixture, adapterDir, oldSession } = paths;
    expect(result.fixtures.deleted).toContain('example.com/111-old');
    expect(result.fixtures.deleted).not.toContain('example.com/999-new');
    await expect(fs.stat(oldFixture)).rejects.toThrow();
    await expect(fs.stat(join(youngFixture, 'page.html'))).resolves.toBeDefined();
    await expect(fs.stat(join(approvedFixture, 'page.html'))).resolves.toBeDefined();
    expect(result.fixtures.scanned).toBe(2);
    expect(result.agentSessions.deleted).toContain('kuronavi/session-111');
    expect(result.agentSessions.deleted).not.toContain('kuronavi/session-999');
    await expect(fs.stat(oldSession)).rejects.toThrow();
    // Live adapter state untouched.
    await expect(fs.stat(join(adapterDir, 'session.json'))).resolves.toBeDefined();
    await expect(fs.stat(join(adapterDir, 'selectors.ts'))).resolves.toBeDefined();
    await expect(fs.stat(join(adapterDir, 'versions', 'v1'))).resolves.toBeDefined();
}

async function MaintenanceServiceTestPrunesStaleIndexEntriesAndDeletesCorruptJobFilesViaMtimeFallback() {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const corruptPath = await seedCorruptDiscoveryJob(old);
    await storage.dispose();
    const challenge = {
        list: async () => [],
        get: async () => null,
        deleteJob: async () => false,
    };
    const service = maintenanceService({
        challengeDiscoveryService: challenge as any,
        workspaceRoot: join(TEST_ROOT, 'workspaces'),
    });
    const result = await service.run();
    // Corrupt file resolved via mtime fallback and deleted through the fallback path.
    expect(result.discoveryJobs.deleted).toContain('ghost-corrupt');
    await expect(fs.stat(corruptPath)).rejects.toThrow();
    // Stale index entries pruned.
    expect(await storage.read<string[]>('challenge-discovery-index')).toEqual([]);
}

async function seedCorruptDiscoveryJob(old: Date): Promise<string> {
  const path = join(TEST_ROOT, 'data', 'challenge-discovery-job-ghost-corrupt.json');
  await fs.writeFile(path, '{not valid json', 'utf-8');
  await fs.utimes(path, old, old);
  await storage.write('challenge-discovery-index', ['ghost-missing', 'ghost-corrupt']);
  return path;
}
