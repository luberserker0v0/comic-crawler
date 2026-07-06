import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TaskManager } from '../../task/manager';
import { summarizeCheckpoint } from '../../task/checkpoint';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';

interface TaskPreviewFile {
  name: string;
  relativePath: string;
  size: number;
  modifiedAt: Date;
  isImage: boolean;
  url?: string;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

async function collectPreviewFiles(rootDir: string, limit = 24): Promise<TaskPreviewFile[]> {
  const previewFiles: TaskPreviewFile[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (previewFiles.length >= limit) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (previewFiles.length >= limit) {
        return;
      }

      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const stats = await fs.stat(absolutePath);
      previewFiles.push({
        name: entry.name,
        relativePath: relative(rootDir, absolutePath),
        size: stats.size,
        modifiedAt: stats.mtime,
        isImage: isPreviewImage(absolutePath),
      });
    }
  }

  await walk(rootDir);
  return previewFiles;
}

async function buildTaskDownloadPreview(
  taskId: string,
  result?: { outputPath?: string; metadata?: Record<string, unknown> | undefined }
) {
  if (!result?.outputPath) {
    return null;
  }

  const rootDir = await resolvePreviewRoot({
    outputPath: result.outputPath,
    metadata: result.metadata,
  });

  try {
    const stats = await fs.stat(rootDir);
    if (!stats.isDirectory()) {
      return null;
    }

    const files = (await collectPreviewFiles(rootDir)).map((file) => ({
      ...file,
      url: file.isImage ? `/api/tasks/${encodeURIComponent(taskId)}/preview-file?path=${encodeURIComponent(file.relativePath)}` : undefined,
    }));
    return {
      rootDir,
      files,
      totalFiles: files.length,
    };
  } catch {
    return null;
  }
}

async function resolvePreviewRoot(result: { outputPath: string; metadata?: Record<string, unknown> | undefined }): Promise<string> {
  const directRoot = isAbsolute(result.outputPath) ? result.outputPath : join(process.cwd(), result.outputPath);
  try {
    const stats = await fs.stat(directRoot);
    if (stats.isDirectory()) return directRoot;
  } catch {
    // Fall back to the legacy layout below.
  }

  const title = typeof result.metadata?.title === 'string' ? result.metadata.title : null;
  return title ? join(directRoot, title) : directRoot;
}

function isPreviewImage(path: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif'].includes(extname(path).toLowerCase());
}

function contentTypeForImage(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}

export function setupTasksRoutes(
  app: FastifyInstance,
  taskManager: TaskManager,
  adapterRegistry: AdapterRegistry,
  discoveryService?: SelectorDiscoveryService,
  challengeDiscoveryService?: ChallengeDiscoveryService
): void {
  app.get('/api/tasks', async (_request: FastifyRequest, reply: FastifyReply) => {
    const tasks = taskManager.getAllTasks();
    const stats = taskManager.getStats();

    reply.send({
      data: {
        tasks: tasks.map((t) => ({
          id: t.id,
          url: t.data.url,
          status: t.status,
          priority: t.priority,
          createdAt: t.createdAt,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
          error: t.error,
          progress: taskManager.getProgress(t.id)
            ? {
                totalItems: taskManager.getProgress(t.id)!.totalItems,
                completedItems: taskManager.getProgress(t.id)!.completedItems,
                failedItems: taskManager.getProgress(t.id)!.failedItems,
                percentage: taskManager.getProgress(t.id)!.percentage,
                currentItems: taskManager.getProgress(t.id)!.currentItems,
              }
            : null,
          checkpoint: summarizeCheckpoint(taskManager.getCheckpoint(t.id)),
        })),
        stats,
      },
    });
  });

  app.get('/api/tasks/priority-order', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { taskIds: taskManager.getPriorityOrder() } });
  });

  app.put('/api/tasks/priority-order', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { taskIds?: string[] };
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds : [];
    reply.send({ data: { taskIds: await taskManager.setPriorityOrder(taskIds) } });
  });

  app.get('/api/tasks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const task = taskManager.getTask(id);

    if (!task) {
      reply.code(404).send({ error: 'Task not found' });
      return;
    }

    const progress = taskManager.getProgress(id);
    const result = taskManager.getTaskResult(id);
    const checkpoint = summarizeCheckpoint(taskManager.getCheckpoint(id));
    const preview = await buildTaskDownloadPreview(id, result);

    reply.send({
      data: {
        task: {
          id: task.id,
          url: task.data.url,
          status: task.status,
          priority: task.priority,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          error: task.error,
        },
        progress,
        result,
        checkpoint,
        preview,
      },
    });
  });

  app.get('/api/tasks/:id/preview-file', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { path?: string };
    const task = taskManager.getTask(id);
    const result = taskManager.getTaskResult(id);
    if (!task || !result?.outputPath || !query.path) {
      reply.code(404).send({ error: 'Preview file not found' });
      return;
    }

    const rootDir = await resolvePreviewRoot(result as { outputPath: string; metadata?: Record<string, unknown> | undefined });
    const root = resolve(rootDir);
    const filePath = resolve(root, query.path);
    if (!filePath.startsWith(`${root}\\`) && filePath !== root && !filePath.startsWith(`${root}/`)) {
      reply.code(400).send({ error: 'Invalid preview path' });
      return;
    }
    if (!isPreviewImage(filePath)) {
      reply.code(415).send({ error: 'Preview file is not an image' });
      return;
    }

    try {
      await fs.access(filePath);
      reply.type(contentTypeForImage(filePath));
      return reply.send(createReadStream(filePath));
    } catch {
      reply.code(404).send({ error: 'Preview file not found' });
    }
  });

  app.post('/api/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      url: string;
      adapterId?: string;
      mode?: 'all' | 'chapters';
      chapters?: string[];
      chapterUrls?: string[];
      priority?: number;
    };
    const mode = body.mode ?? 'all';

    if (!body.url) {
      reply.code(400).send({ error: 'URL is required' });
      return;
    }

    if (!isValidUrl(body.url)) {
      reply.code(400).send({ error: 'URL must be a valid absolute URL' });
      return;
    }

    if (mode !== 'all' && mode !== 'chapters') {
      reply.code(400).send({ error: 'Task mode must be "all" or "chapters"' });
      return;
    }

    const chapterUrls = body.chapterUrls?.map((chapterUrl) => chapterUrl.trim()).filter(Boolean) ?? [];
    if (mode === 'chapters' && chapterUrls.length === 0) {
      reply.code(400).send({ error: 'At least one chapter URL is required' });
      return;
    }

    if (chapterUrls.some((chapterUrl) => !isValidUrl(chapterUrl))) {
      reply.code(400).send({ error: 'Every chapter URL must be a valid absolute URL' });
      return;
    }

    const lookupUrl = mode === 'chapters' ? chapterUrls[0] ?? body.url : body.url;
    const requiredCapabilities = mode === 'chapters'
      ? { chapterImages: true }
      : { metadata: true, chapterImages: true };

    let adapterId = body.adapterId;
    if (adapterId) {
      const adapter = adapterRegistry.get(adapterId);
      if (!adapter) {
        reply.code(400).send({ error: `Adapter "${adapterId}" was not found` });
        return;
      }
      const capabilities = getAdapterCapabilities(adapter);
      if (!adapterSupports(capabilities, requiredCapabilities)) {
        if (discoveryService) {
          const discovery = await discoveryService.create({
            url: lookupUrl,
            target: mode === 'chapters' ? 'chapter-only' : 'full',
            forceDiscovery: true,
          });
          reply.code(202).send({
            data: {
              kind: 'discoveryQueued',
              reason: 'adapter_capability_mismatch',
              discoveryId: discovery.id,
              status: discovery.status,
              normalizedUrl: discovery.normalizedUrl,
              target: discovery.target,
              adapterId,
              adapterName: adapter.name,
              requiredCapabilities,
              capabilities,
            },
          });
          return;
        }

        reply.code(400).send({
          error: 'Adapter capability mismatch',
          data: {
            kind: 'adapter_capability_mismatch',
            adapterId,
            requiredCapabilities,
            capabilities,
          },
        });
        return;
      }
    } else {
      const matchedAdapter = adapterRegistry.findByUrlWithCapabilities(lookupUrl, requiredCapabilities);
      if (!matchedAdapter) {
        const anyMatchedAdapter = adapterRegistry.findByUrl(lookupUrl);
        if (discoveryService) {
          if (!anyMatchedAdapter && challengeDiscoveryService) {
            const challengeProbe = await challengeDiscoveryService.probe(lookupUrl);
            if (challengeProbe.status === 'challenge' && challengeProbe.job) {
              reply.code(202).send({
                data: {
                  kind: 'challengeDiscoveryQueued',
                  reason: 'browser_challenge',
                  challengeDiscoveryId: challengeProbe.job.id,
                  status: challengeProbe.job.status,
                  normalizedUrl: challengeProbe.job.normalizedUrl,
                  requiredCapabilities,
                },
              });
              return;
            }
          }
          const discovery = await discoveryService.create({
            url: lookupUrl,
            target: mode === 'chapters' ? 'chapter-only' : 'full',
            forceDiscovery: Boolean(anyMatchedAdapter),
          });
          reply.code(202).send({
            data: {
              kind: 'discoveryQueued',
              reason: anyMatchedAdapter ? 'adapter_capability_mismatch' : 'adapter_not_found',
              discoveryId: discovery.id,
              status: discovery.status,
              normalizedUrl: discovery.normalizedUrl,
              target: discovery.target,
              adapterId: anyMatchedAdapter?.id,
              adapterName: anyMatchedAdapter?.name,
              requiredCapabilities,
              capabilities: anyMatchedAdapter ? getAdapterCapabilities(anyMatchedAdapter) : undefined,
            },
          });
          return;
        }

        reply.code(400).send({
          error: anyMatchedAdapter ? 'Adapter capability mismatch' : 'No adapter found for the given URL',
          data: {
            kind: anyMatchedAdapter ? 'adapter_capability_mismatch' : 'adapter_not_found',
            adapterId: anyMatchedAdapter?.id,
            adapterName: anyMatchedAdapter?.name,
            requiredCapabilities,
            capabilities: anyMatchedAdapter ? getAdapterCapabilities(anyMatchedAdapter) : undefined,
          },
        });
        return;
      }
      adapterId = matchedAdapter.id;
    }

    const taskId = await taskManager.createTask({
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: body.url,
      adapterId,
      mode,
      chapters: body.chapters,
      chapterUrls,
      priority: body.priority ?? 0,
    });

    reply.code(201).send({ data: { kind: 'taskCreated', taskId } });
  });

  app.post('/api/tasks/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const success = await taskManager.pauseTask(id);

    if (!success) {
      reply.code(400).send({ error: 'Failed to pause task' });
      return;
    }

    reply.send({ data: { message: 'Task paused' } });
  });

  app.post('/api/tasks/:id/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const task = taskManager.getTask(id);
    const result = taskManager.getTaskResult(id);
    if (task?.status === 'waiting_verification') {
      const challengeDiscoveryId = result?.challengeDiscoveryId;
      if (!challengeDiscoveryService) {
        reply.code(400).send({ error: 'Task is waiting for verification, but challenge discovery service is not available.' });
        return;
      }
      if (!challengeDiscoveryId) {
        const recreated = await recreateChallengeJobForTask(taskManager, challengeDiscoveryService, id);
        reply.code(409).send({
          error: 'Verification handoff was missing. A new human verification job was created; open the browser from the task panel again.',
          data: { challenge: recreated },
        });
        return;
      }
      let challengeJob;
      try {
        challengeJob = await challengeDiscoveryService.get(challengeDiscoveryId);
        if (!challengeJob) {
          throw new Error(`Challenge discovery job "${challengeDiscoveryId}" was not found.`);
        }
        if (challengeJob.status !== 'ready') {
          challengeJob = await challengeDiscoveryService.completeHumanVerification(challengeDiscoveryId);
        }
      } catch (error) {
        if (isMissingChallengeJobError(error)) {
          const recreated = await recreateChallengeJobForTask(taskManager, challengeDiscoveryService, id);
          reply.code(409).send({
            error: 'Verification handoff expired or was removed. A new human verification job was created; open the browser from the task panel again.',
            data: { challenge: recreated },
          });
          return;
        }
        throw error;
      }
      if (challengeJob.status !== 'ready') {
        const message = challengeJob.error ?? 'Human verification is not ready yet. Complete verification in the opened browser, then press Continue again.';
        await taskManager.updateResult(id, {
          challengeStatus: challengeJob.status,
          error: message,
        });
        await taskManager.updateTaskError(id, message);
        reply.code(409).send({
          error: message,
          data: { challenge: challengeJob },
        });
        return;
      }
      await taskManager.updateResult(id, {
        challengeStatus: challengeJob.status,
        error: undefined,
      });
      await taskManager.updateTaskError(id, undefined);
    }

    const success = await taskManager.resumeTask(id);

    if (!success) {
      reply.code(400).send({ error: 'Failed to resume task' });
      return;
    }

    reply.send({ data: { message: 'Task resumed' } });
  });

  app.post('/api/tasks/:id/cancel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const success = await taskManager.cancelTask(id);

    if (!success) {
      reply.code(400).send({ error: 'Failed to cancel task' });
      return;
    }

    reply.send({ data: { message: 'Task cancelled' } });
  });

  app.delete('/api/tasks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const success = await taskManager.deleteTask(id);

    if (!success) {
      reply.code(400).send({ error: 'Failed to delete task' });
      return;
    }

    reply.send({ data: { message: 'Task deleted' } });
  });
}

function adapterSupports(
  capabilities: { verification?: boolean; metadata: boolean; chapterImages: boolean },
  required: Partial<{ metadata: boolean; chapterImages: boolean }>
): boolean {
  return Object.entries(required).every(([key, value]) =>
    value === undefined || capabilities[key as keyof typeof capabilities] === value
  );
}

async function recreateChallengeJobForTask(
  taskManager: TaskManager,
  challengeDiscoveryService: ChallengeDiscoveryService,
  taskId: string
) {
  const task = taskManager.getTask(taskId);
  if (!task) {
    throw new Error(`Task "${taskId}" was not found.`);
  }
  const verificationUrl = task.data.chapterUrls?.[0] ?? task.data.url;
  const challengeJob = await challengeDiscoveryService.create({ url: verificationUrl });
  const message = `Verification handoff expired or was removed. New challenge discovery job: ${challengeJob.id}`;
  await taskManager.updateResult(taskId, {
    challengeDiscoveryId: challengeJob.id,
    challengeStatus: challengeJob.status,
    error: message,
  });
  await taskManager.updateTaskError(taskId, message);
  return challengeJob;
}

function isMissingChallengeJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /challenge discovery job .*not found|challenge discovery job .*was not found/i.test(message);
}
