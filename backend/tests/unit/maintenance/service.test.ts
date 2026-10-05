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

describe('MaintenanceService', () => {
  let storage: JsonFileStore;
  let taskManager: TaskManager;

  beforeEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(join(TEST_ROOT, 'data'), { recursive: true });
    await fs.mkdir(join(TEST_ROOT, 'downloads', 'example'), { recursive: true });
    storage = new JsonFileStore({ basePath: join(TEST_ROOT, 'data'), flushInterval: 0 });
    await storage.initialize();
    taskManager = new TaskManager(async () => {}, { eventBus: new EventBus(), storage });
    await taskManager.initialize();
  });

  afterEach(async () => {
    await taskManager.dispose().catch(() => undefined);
    await storage.dispose().catch(() => undefined);
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

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

  function stubDiscovery(jobs: Array<{ id: string; updatedAt: string }>) {
    const store = new Map(jobs.map((job) => [job.id, { ...job }]));
    return {
      list: async () => Array.from(store.values()),
      get: async (id: string) => store.get(id) ?? null,
      deleteJob: async (id: string) => store.delete(id),
    };
  }

  it('dry-run deletes nothing', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await createCompletedTask('old-task', old);
    const service = new MaintenanceService({
      storage,
      taskManager,
      downloadDir: join(TEST_ROOT, 'downloads'),
      getPolicy: async () => ({
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      }),
    });
    const result = await service.preview();
    expect(result.dryRun).toBe(true);
    expect(result.tasks.deleted).toContain('old-task');
    expect(taskManager.getTask('old-task')).toBeDefined();
    expect(await storage.read(`tasks/old-task`)).not.toBeNull();
  });

  it('deletes expired tasks with files, expired jobs and orphan profiles', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const outputDir = join(TEST_ROOT, 'downloads', 'example', 'old-comic');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(join(outputDir, '001.jpg'), 'fake-image');
    await createCompletedTask('old-task', old, join('example', 'old-comic'));
    await createCompletedTask('recent-task', new Date());

    // Active task must be skipped.
    const blockedRelease = { release: () => {} };
    void blockedRelease;
    await taskManager.createTask({ id: 'pending-task', url: 'https://example.com/2', adapterId: 'test' });
    // Force it back to pending (executor may have completed it); emulate an active task.
    const pending = taskManager.getTask('pending-task');
    if (pending) {
      pending.status = 'pending';
      pending.completedAt = undefined;
    }
    await taskManager.updateResult('pending-task', { status: 'pending', completedAt: undefined });
    await flush();

    const selector = stubDiscovery([{ id: 'old-disc', updatedAt: old.toISOString() }]);
    const challenge = stubDiscovery([{ id: 'old-chal', updatedAt: old.toISOString() }]);
    const profileDir = join(TEST_ROOT, 'workspaces', 'challenge-discoveries', 'old-chal');
    await fs.mkdir(join(profileDir, 'external-browser-profile'), { recursive: true });
    await fs.writeFile(join(profileDir, 'external-browser-profile', 'prefs.json'), '{}');

    const service = new MaintenanceService({
      storage,
      taskManager,
      selectorDiscoveryService: selector as any,
      challengeDiscoveryService: challenge as any,
      workspaceRoot: join(TEST_ROOT, 'workspaces'),
      downloadDir: join(TEST_ROOT, 'downloads'),
      getPolicy: async () => ({
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      }),
    });
    const result = await service.run();

    expect(result.tasks.deleted).toContain('old-task');
    expect(result.tasks.deleted).not.toContain('recent-task');
    expect(result.tasks.deleted).not.toContain('pending-task');
    expect(taskManager.getTask('old-task')).toBeUndefined();
    await expect(fs.stat(outputDir)).rejects.toThrow();

    expect(result.discoveryJobs.deleted).toContain('old-disc');
    expect(result.discoveryJobs.deleted).toContain('old-chal');
    await expect(fs.stat(profileDir)).rejects.toThrow();
    expect(result.browserProfiles.deleted).toContain('old-chal');
    expect(result.browserProfiles.bytesFreed).toBeGreaterThan(0);
  });

  it('skips discovery jobs referenced by remaining tasks', async () => {    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await createCompletedTask('recent-task', new Date());
    await taskManager.updateResult('recent-task', { challengeDiscoveryId: 'live-chal' });
    const challenge = stubDiscovery([{ id: 'live-chal', updatedAt: old.toISOString() }]);
    const service = new MaintenanceService({
      storage,
      taskManager,
      challengeDiscoveryService: challenge as any,
      getPolicy: async () => ({
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      }),
    });
    const result = await service.run();
    expect(result.discoveryJobs.deleted).not.toContain('live-chal');
    expect(result.discoveryJobs.skipped.join(' ')).toMatch(/referenced/);
  });

  it('deleteJob removes implementation, manifest and shadow-promotion keys (no residual JSON)', async () => {
    const service = new SelectorDiscoveryService(storage, new AdapterRegistry(new EventBus()));
    const job: any = { id: 'disc-1', url: 'https://example.com/', normalizedUrl: 'https://example.com/', hostname: 'example.com', status: 'awaiting_review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await storage.write('selector-discovery-job-disc-1', job);
    await storage.write('selector-discovery-index', ['disc-1']);
    await storage.write('selector-discovery-implementation-disc-1', { reviewNotesMarkdown: 'x' });
    await storage.write('selector-discovery-manifest-disc-1', { markdown: 'y' });
    await storage.write('selector-discovery-shadow-promotion-disc-1', { shadowPromotion: { id: 'shadow-disc-1' } });
    await storage.dispose();

    expect(await service.deleteJob('disc-1')).toBe(true);
    await storage.dispose().catch(() => undefined);
    const keys = await storage.list();
    expect(keys.filter((key) => key.includes('disc-1'))).toEqual([]);
    expect(await storage.read<string[]>('selector-discovery-index')).toEqual([]);
  });

  it('cleans expired fixtures and agent sessions but keeps live adapter state', async () => {    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const workspaces = join(TEST_ROOT, 'workspaces');
    const oldFixture = join(workspaces, 'fixtures', 'example.com', '111-old');
    const youngFixture = join(workspaces, 'fixtures', 'example.com', '999-new');
    await fs.mkdir(oldFixture, { recursive: true });
    await fs.writeFile(join(oldFixture, 'page.html'), '<html></html>');
    await fs.mkdir(youngFixture, { recursive: true });
    await fs.writeFile(join(youngFixture, 'page.html'), '<html></html>');
    await fs.utimes(oldFixture, old, old);

    // Live adapter state that must never be touched.
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

    const service = new MaintenanceService({
      storage,
      taskManager,
      workspaceRoot: workspaces,
      downloadDir: join(TEST_ROOT, 'downloads'),
      getPolicy: async () => ({
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      }),
    });
    const result = await service.run();
    expect(result.fixtures.deleted).toContain('example.com/111-old');
    expect(result.fixtures.deleted).not.toContain('example.com/999-new');
    await expect(fs.stat(oldFixture)).rejects.toThrow();
    await expect(fs.stat(join(youngFixture, 'page.html'))).resolves.toBeDefined();

    expect(result.agentSessions.deleted).toContain('kuronavi/session-111');
    expect(result.agentSessions.deleted).not.toContain('kuronavi/session-999');
    await expect(fs.stat(oldSession)).rejects.toThrow();
    // Live adapter state untouched.
    await expect(fs.stat(join(adapterDir, 'session.json'))).resolves.toBeDefined();
    await expect(fs.stat(join(adapterDir, 'selectors.ts'))).resolves.toBeDefined();
    await expect(fs.stat(join(adapterDir, 'versions', 'v1'))).resolves.toBeDefined();
  });

  it('prunes stale index entries and deletes corrupt job files via mtime fallback', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    // Index references a job file that no longer exists.
    await storage.write('challenge-discovery-index', ['ghost-missing']);
    // Corrupt (unparseable) job file with old mtime.
    const corruptPath = join(TEST_ROOT, 'data', 'challenge-discovery-job-ghost-corrupt.json');
    await fs.writeFile(corruptPath, '{not valid json', 'utf-8');
    await fs.utimes(corruptPath, old, old);
    await storage.write('challenge-discovery-index', ['ghost-missing', 'ghost-corrupt']);
    await storage.dispose();

    const challenge = {
      list: async () => [],
      get: async () => null,
      deleteJob: async () => false,
    };
    const service = new MaintenanceService({
      storage,
      taskManager,
      challengeDiscoveryService: challenge as any,
      workspaceRoot: join(TEST_ROOT, 'workspaces'),
      downloadDir: join(TEST_ROOT, 'downloads'),
      getPolicy: async () => ({
        enabled: true,
        intervalHours: 24,
        tasksRetainDays: 30,
        discoveryJobsRetainDays: 14,
        browserProfilesRetainDays: 14,
        deleteFiles: true,
        deleteOrphanProfiles: true,
        batchLimit: 100,
      }),
    });
    const result = await service.run();
    // Corrupt file resolved via mtime fallback and deleted through the fallback path.
    expect(result.discoveryJobs.deleted).toContain('ghost-corrupt');
    await expect(fs.stat(corruptPath)).rejects.toThrow();
    // Stale index entries pruned.
    expect(await storage.read<string[]>('challenge-discovery-index')).toEqual([]);
  });
});
