import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TaskManager } from '../../task/manager';
import { summarizeCheckpoint } from '../../task/checkpoint';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { BrowserWorkerLeaseCoordinator } from '../../browser/browser-worker-lease-coordinator';
import type { ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';
import type { ExistingTabBrowserTarget } from '@comiccrawler/shared';
import {
  BrowserTargetRebindError,
} from '../../task/manager';
import { BrowserTargetRecoveryService } from '../../task/browser-target-recovery-service';
import { adapterSupports, isMissingChallengeJobError, recreateChallengeJobForTask } from './tasks-challenge';
import { buildTaskDownloadPreview, contentTypeForImage, isPreviewImage, resolvePreviewRoot } from './tasks-preview';

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

interface TaskRoutesOptions {
  downloadDir?: string | (() => string | Promise<string>);
  browserLeaseCoordinator?: BrowserWorkerLeaseCoordinator;
  apiSecurity?: ApiSecurityService;
}

export function setupTasksRoutes(
  app: FastifyInstance,
  taskManager: TaskManager,
  adapterRegistry: AdapterRegistry,
  discoveryService?: SelectorDiscoveryService,
  challengeDiscoveryService?: ChallengeDiscoveryService,
  options?: TaskRoutesOptions
): void {
  const browserTargetRecovery = options?.browserLeaseCoordinator
    ? new BrowserTargetRecoveryService(taskManager, options.browserLeaseCoordinator, challengeDiscoveryService)
    : undefined;
  const context = { taskManager, adapterRegistry, discoveryService, challengeDiscoveryService,
    options, browserTargetRecovery };
  registerTaskQueryRoutes(app, context);
  registerTaskCreationRoute(app, context);
  registerTaskLifecycleRoutes(app, context);
}

type TaskRouteContext = {
  taskManager: TaskManager; adapterRegistry: AdapterRegistry;
  discoveryService?: SelectorDiscoveryService; challengeDiscoveryService?: ChallengeDiscoveryService;
  options?: TaskRoutesOptions; browserTargetRecovery?: BrowserTargetRecoveryService;
};

function registerTaskQueryRoutes(app: FastifyInstance, ctx: TaskRouteContext): void {
  app.get('/api/tasks', (_request, reply) => listTasks(ctx, reply));
  app.get('/api/tasks/priority-order', (_request, reply) =>
    reply.send({ data: { taskIds: ctx.taskManager.getPriorityOrder() } }));
  app.put('/api/tasks/priority-order', (request, reply) => updatePriorityOrder(ctx, request, reply));
  app.get('/api/tasks/:id', (request, reply) => getTask(ctx, request, reply));
  app.post('/api/tasks/:id/rebind-browser-target', (request, reply) => rebindBrowserTarget(ctx, request, reply));
  app.get('/api/tasks/:id/preview-file', (request, reply) => sendPreviewFile(ctx, request, reply));
}

function registerTaskCreationRoute(app: FastifyInstance, ctx: TaskRouteContext): void {
  app.post('/api/tasks', (request, reply) => createTask(ctx, request, reply));
}

function registerTaskLifecycleRoutes(app: FastifyInstance, ctx: TaskRouteContext): void {
  app.post('/api/tasks/:id/pause', (request, reply) => pauseTask(ctx, request, reply));
  app.post('/api/tasks/:id/resume', (request, reply) => resumeTask(ctx, request, reply));
  app.post('/api/tasks/:id/cancel', (request, reply) => cancelTask(ctx, request, reply));
  app.delete('/api/tasks/:id', (request, reply) => deleteTask(ctx, request, reply));
}

function listTasks(ctx: TaskRouteContext, reply: FastifyReply): void {
  const tasks = ctx.taskManager.getAllTasks().map((task) => serializeTask(ctx.taskManager, task));
  reply.send({ data: { tasks, stats: ctx.taskManager.getStats() } });
}

function serializeTask(manager: TaskManager, task: ReturnType<TaskManager['getAllTasks']>[number]) {
  const progress = manager.getProgress(task.id);
  return { id: task.id, url: task.data.url, mode: task.data.mode, status: task.status,
    priority: task.priority, createdAt: task.createdAt, startedAt: task.startedAt,
    completedAt: task.completedAt, error: task.error, browserTarget: task.data.browserTarget,
    progress: progress ? { totalItems: progress.totalItems, completedItems: progress.completedItems,
      failedItems: progress.failedItems, percentage: progress.percentage, currentItems: progress.currentItems } : null,
    checkpoint: summarizeCheckpoint(manager.getCheckpoint(task.id)) };
}

async function updatePriorityOrder(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as { taskIds?: string[] };
  const taskIds = Array.isArray(body.taskIds) ? body.taskIds : [];
  reply.send({ data: { taskIds: await ctx.taskManager.setPriorityOrder(taskIds) } });
}

async function getTask(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  const task = ctx.taskManager.getTask(id);
  if (!task) return void reply.code(404).send({ error: 'Task not found' });
  const result = ctx.taskManager.getTaskResult(id);
  reply.send({ data: { task: serializeTaskIdentity(task), progress: ctx.taskManager.getProgress(id), result,
    checkpoint: summarizeCheckpoint(ctx.taskManager.getCheckpoint(id)),
    preview: await buildTaskDownloadPreview(id, result), events: ctx.taskManager.getEvents(id) } });
}

function serializeTaskIdentity(task: NonNullable<ReturnType<TaskManager['getTask']>>) {
  return { id: task.id, url: task.data.url, mode: task.data.mode, status: task.status,
    priority: task.priority, createdAt: task.createdAt, startedAt: task.startedAt,
    completedAt: task.completedAt, error: task.error, browserTarget: task.data.browserTarget };
}

async function rebindBrowserTarget(
  ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  if (!ctx.browserTargetRecovery)
    return void reply.code(503).send({ error: 'Browser Target recovery is not configured.' });
  const targets = parseRecoveryTargets((request.body ?? {}) as Record<string, unknown>);
  if (targets instanceof Error) return void reply.code(400).send({ error: targets.message });
  const { id } = request.params as { id: string };
  const principal = ctx.options?.apiSecurity ? requestPrincipal(request, ctx.options.apiSecurity) : { userId: 'public' };
  try {
    const outcome = await ctx.browserTargetRecovery.recover({ taskId: id, ownerUserId: principal.userId, ...targets });
    reply.send({ data: formatRecoveryOutcome(outcome) });
  } catch (error) { handleRecoveryError(error, reply); }
}

function parseRecoveryTargets(body: Record<string, unknown>) {
  const unknown = Object.keys(body).find((field) => !['expectedBrowserTarget', 'browserTarget'].includes(field));
  if (unknown) return new Error(`Unknown recovery field "${unknown}".`);
  const expectedBrowserTarget = parseExistingTabBrowserTarget(body.expectedBrowserTarget);
  const browserTarget = parseExistingTabBrowserTarget(body.browserTarget);
  if (expectedBrowserTarget instanceof Error) return new Error(`expectedBrowserTarget: ${expectedBrowserTarget.message}`);
  if (browserTarget instanceof Error) return new Error(`browserTarget: ${browserTarget.message}`);
  return { expectedBrowserTarget, browserTarget };
}

function formatRecoveryOutcome(outcome: Awaited<ReturnType<BrowserTargetRecoveryService['recover']>>) {
  return { task: { id: outcome.task.id, status: outcome.task.status,
    browserTarget: outcome.task.data.browserTarget }, previousBrowserTarget: outcome.event.previousBrowserTarget,
    recovery: { ...outcome.event.recovery, idempotent: outcome.idempotent },
    ...(outcome.challenge ? { challenge: outcome.challenge } : {}) };
}

function handleRecoveryError(error: unknown, reply: FastifyReply): void {
  if (!(error instanceof BrowserTargetRebindError)) throw error;
  const code = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403
    : error.code === 'STALE_TARGET' || error.code === 'INVALID_STATE' ? 409 : 400;
  reply.code(code).send({ error: error.message, code: error.code });
}

async function sendPreviewFile(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const { id } = request.params as { id: string };
  const path = (request.query as { path?: string }).path;
  const result = ctx.taskManager.getTaskResult(id);
  if (!ctx.taskManager.getTask(id) || !result?.outputPath || !path)
    return reply.code(404).send({ error: 'Preview file not found' });
  const rootDir = await resolvePreviewRoot(result as { outputPath: string; metadata?: Record<string, unknown> });
  const root = resolve(rootDir);
  const filePath = resolve(root, path);
  if (!isPathInside(root, filePath)) return reply.code(400).send({ error: 'Invalid preview path' });
  if (!isPreviewImage(filePath)) return reply.code(415).send({ error: 'Preview file is not an image' });
  return streamPreviewFile(filePath, reply);
}

function isPathInside(root: string, filePath: string): boolean {
  return filePath === root || filePath.startsWith(`${root}\\`) || filePath.startsWith(`${root}/`);
}

async function streamPreviewFile(filePath: string, reply: FastifyReply): Promise<unknown> {
  try {
    await fs.access(filePath);
    reply.type(contentTypeForImage(filePath));
    return reply.send(createReadStream(filePath));
  } catch { return reply.code(404).send({ error: 'Preview file not found' }); }
}

interface TaskCreateBody {
  url: string; adapterId?: string; mode?: 'all' | 'chapters'; chapters?: string[];
  chapterUrls?: string[]; priority?: number;
  browserTarget?: { mode?: string; workerId?: string; resourceId?: string };
}

interface ParsedTaskRequest {
  body: TaskCreateBody; mode: 'all' | 'chapters'; chapterUrls: string[];
  browserTarget: Exclude<ReturnType<typeof parseBrowserTarget>, Error>;
  lookupUrl: string; requiredCapabilities: { metadata?: boolean; chapterImages: boolean };
}

const TASK_CREATE_FIELDS = new Set(['url', 'adapterId', 'mode', 'chapters', 'chapterUrls', 'priority', 'browserTarget']);

async function createTask(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = parseTaskRequest((request.body ?? {}) as Record<string, unknown>);
  if (parsed instanceof Error) return void reply.code(400).send({ error: parsed.message });
  const ownerUserId = ctx.options?.apiSecurity
    ? requestPrincipal(request, ctx.options.apiSecurity).userId : 'public';
  const targetError = validateBrowserTarget(ctx, ownerUserId, parsed.browserTarget);
  if (targetError) return void reply.code(400).send({ error: targetError });
  const resolution = await resolveTaskAdapter(ctx, parsed, ownerUserId);
  if ('payload' in resolution) return void reply.code(resolution.status).send(resolution.payload);
  const taskId = await createResolvedTask(ctx, parsed, resolution.adapterId, ownerUserId);
  reply.code(201).send({ data: { kind: 'taskCreated', taskId, browserTarget: parsed.browserTarget } });
}

function parseTaskRequest(raw: Record<string, unknown>): ParsedTaskRequest | Error {
  const unknown = Object.keys(raw).find((field) => !TASK_CREATE_FIELDS.has(field));
  if (unknown) return new Error(`Unknown task field "${unknown}".`);
  const body = raw as unknown as TaskCreateBody;
  const mode = body.mode ?? 'all';
  if (!body.url) return new Error('URL is required');
  if (!isValidUrl(body.url)) return new Error('URL must be a valid absolute URL');
  if (mode !== 'all' && mode !== 'chapters') return new Error('Task mode must be "all" or "chapters"');
  const chapterUrls = body.chapterUrls?.map((url) => url.trim()).filter(Boolean) ?? [];
  if (mode === 'chapters' && chapterUrls.length === 0) return new Error('At least one chapter URL is required');
  if (chapterUrls.some((url) => !isValidUrl(url))) return new Error('Every chapter URL must be a valid absolute URL');
  const browserTarget = parseBrowserTarget(body.browserTarget);
  if (browserTarget instanceof Error) return browserTarget;
  return { body, mode, chapterUrls, browserTarget, lookupUrl: mode === 'chapters' ? chapterUrls[0]! : body.url,
    requiredCapabilities: mode === 'chapters' ? { chapterImages: true } : { metadata: true, chapterImages: true } };
}

function validateBrowserTarget(ctx: TaskRouteContext, owner: string, target: ParsedTaskRequest['browserTarget']): string | undefined {
  try { ctx.options?.browserLeaseCoordinator?.validateTarget(owner, target); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  return undefined;
}

type AdapterResolution = { adapterId: string } | { status: number; payload: Record<string, unknown> };

async function resolveTaskAdapter(
  ctx: TaskRouteContext, input: ParsedTaskRequest, ownerUserId: string
): Promise<AdapterResolution> {
  if (input.body.adapterId) return resolveRequestedAdapter(ctx, input, ownerUserId, input.body.adapterId);
  const matched = ctx.adapterRegistry.findByUrlWithCapabilities(input.lookupUrl, input.requiredCapabilities);
  if (matched) return { adapterId: matched.id };
  const exact = ctx.adapterRegistry.findByUrl(input.lookupUrl);
  const supplement = input.mode === 'all' ? ctx.adapterRegistry.findByUrlDomain(input.lookupUrl) : undefined;
  return resolveMissingAdapter(ctx, input, ownerUserId, exact ?? supplement);
}

async function resolveRequestedAdapter(
  ctx: TaskRouteContext, input: ParsedTaskRequest, owner: string, adapterId: string
): Promise<AdapterResolution> {
  const adapter = ctx.adapterRegistry.get(adapterId);
  if (!adapter) return { status: 400, payload: { error: `Adapter "${adapterId}" was not found` } };
  const capabilities = getAdapterCapabilities(adapter);
  if (adapterSupports(capabilities, input.requiredCapabilities)) return { adapterId };
  return createDiscoveryResolution(ctx, input, owner, adapter, 'adapter_capability_mismatch', true);
}

async function resolveMissingAdapter(
  ctx: TaskRouteContext, input: ParsedTaskRequest, owner: string,
  adapter: ReturnType<AdapterRegistry['findByUrl']>
): Promise<AdapterResolution> {
  const challenge = !adapter ? await probeTaskChallenge(ctx, input, owner) : undefined;
  if (challenge) return challenge;
  const reason = adapter ? 'adapter_capability_mismatch' : 'adapter_not_found';
  return createDiscoveryResolution(ctx, input, owner, adapter, reason, Boolean(adapter));
}

async function probeTaskChallenge(
  ctx: TaskRouteContext, input: ParsedTaskRequest, owner: string
): Promise<AdapterResolution | undefined> {
  if (!ctx.discoveryService || !ctx.challengeDiscoveryService) return undefined;
  const probe = await ctx.challengeDiscoveryService.probe(input.lookupUrl,
    { ownerUserId: owner, browserTarget: input.browserTarget });
  if (probe.status !== 'challenge' || !probe.job) return undefined;
  return { status: 202, payload: { data: { kind: 'challengeDiscoveryQueued', reason: 'browser_challenge',
    challengeDiscoveryId: probe.job.id, status: probe.job.status,
    normalizedUrl: probe.job.normalizedUrl, requiredCapabilities: input.requiredCapabilities } } };
}

async function createDiscoveryResolution(
  ctx: TaskRouteContext, input: ParsedTaskRequest, owner: string,
  adapter: ReturnType<AdapterRegistry['findByUrl']>, reason: string, forceDiscovery: boolean
): Promise<AdapterResolution> {
  const capabilities = adapter ? getAdapterCapabilities(adapter) : undefined;
  if (!ctx.discoveryService) return { status: 400, payload: { error: adapter
    ? 'Adapter capability mismatch' : 'No adapter found for the given URL', data: {
      kind: reason, adapterId: adapter?.id, adapterName: adapter?.name,
      requiredCapabilities: input.requiredCapabilities, capabilities } } };
  const discovery = await ctx.discoveryService.create({ url: input.lookupUrl,
    target: input.mode === 'chapters' ? 'chapter-only' : 'full', forceDiscovery,
    ownerUserId: owner, browserTarget: input.browserTarget });
  return { status: 202, payload: { data: { kind: 'discoveryQueued', reason,
    discoveryId: discovery.id, status: discovery.status, normalizedUrl: discovery.normalizedUrl,
    target: discovery.target, adapterId: adapter?.id, adapterName: adapter?.name,
    requiredCapabilities: input.requiredCapabilities, capabilities } } };
}

function createResolvedTask(
  ctx: TaskRouteContext, input: ParsedTaskRequest, adapterId: string, ownerUserId: string
): Promise<string> {
  return ctx.taskManager.createTask({ id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: input.body.url, adapterId, mode: input.mode, chapters: input.body.chapters,
    chapterUrls: input.chapterUrls, priority: input.body.priority ?? 0, ownerUserId,
    browserTarget: input.browserTarget });
}

async function pauseTask(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  if (!await ctx.taskManager.pauseTask(id)) return void reply.code(400).send({ error: 'Failed to pause task' });
  reply.send({ data: { message: 'Task paused' } });
}

async function resumeTask(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  if (ctx.taskManager.getTask(id)?.status === 'waiting_verification') {
    const ready = await prepareVerificationResume(ctx, id, reply);
    if (!ready) return;
  }
  if (!await ctx.taskManager.resumeTask(id))
    return void reply.code(400).send({ error: 'Failed to resume task' });
  reply.send({ data: { message: 'Task resumed' } });
}

async function prepareVerificationResume(ctx: TaskRouteContext, id: string, reply: FastifyReply): Promise<boolean> {
  const service = ctx.challengeDiscoveryService;
  if (!service) {
    reply.code(400).send({ error: 'Task is waiting for verification, but challenge discovery service is not available.' });
    return false;
  }
  const challengeId = ctx.taskManager.getTaskResult(id)?.challengeDiscoveryId;
  if (!challengeId) return recreateMissingChallenge(ctx, service, id, reply, false);
  const job = await resolveResumeChallenge(ctx, service, id, challengeId, reply);
  if (!job) return false;
  if (job.status !== 'ready') return reportChallengeNotReady(ctx, id, job, reply);
  await clearChallengeError(ctx, id, job.status);
  service.detachBrowserLease?.(challengeId);
  return true;
}

async function resolveResumeChallenge(
  ctx: TaskRouteContext, service: ChallengeDiscoveryService, taskId: string,
  challengeId: string, reply: FastifyReply
) {
  try {
    const current = await service.get(challengeId);
    if (!current) throw new Error(`Challenge discovery job "${challengeId}" was not found.`);
    return current.status === 'ready' ? current : service.completeHumanVerification(challengeId);
  } catch (error) {
    if (!isMissingChallengeJobError(error)) throw error;
    await recreateMissingChallenge(ctx, service, taskId, reply, true);
    return undefined;
  }
}

async function recreateMissingChallenge(
  ctx: TaskRouteContext, service: ChallengeDiscoveryService, id: string,
  reply: FastifyReply, expired: boolean
): Promise<false> {
  const recreated = await recreateChallengeJobForTask(ctx.taskManager, service, id);
  const reason = expired ? 'expired or was removed' : 'was missing';
  reply.code(409).send({ error: `Verification handoff ${reason}. A new human verification job was created; open the browser from the task panel again.`,
    data: { challenge: recreated } });
  return false;
}

async function reportChallengeNotReady(
  ctx: TaskRouteContext, id: string, job: NonNullable<Awaited<ReturnType<ChallengeDiscoveryService['get']>>>,
  reply: FastifyReply
): Promise<false> {
  const message = job.error ?? 'Human verification is not ready yet. Complete verification in the opened browser, then press Continue again.';
  await ctx.taskManager.updateResult(id, { challengeStatus: job.status, error: message });
  await ctx.taskManager.updateTaskError(id, message);
  reply.code(409).send({ error: message, data: { challenge: job } });
  return false;
}

async function clearChallengeError(ctx: TaskRouteContext, id: string, status: string): Promise<void> {
  await ctx.taskManager.updateResult(id, { challengeStatus: status, error: undefined });
  await ctx.taskManager.updateTaskError(id, undefined);
}

async function cancelTask(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  if (!await ctx.taskManager.cancelTask(id)) return void reply.code(400).send({ error: 'Failed to cancel task' });
  await releaseTaskResources(ctx, id);
  reply.send({ data: { message: 'Task cancelled' } });
}

async function deleteTask(ctx: TaskRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  const challengeId = ctx.taskManager.getTaskResult(id)?.challengeDiscoveryId;
  const value = (request.query as { deleteFiles?: string | boolean }).deleteFiles;
  const deleteFiles = value === true || value === 'true' || value === '1';
  const downloadDir = typeof ctx.options?.downloadDir === 'function'
    ? await ctx.options.downloadDir() : ctx.options?.downloadDir;
  const outcome = await ctx.taskManager.deleteTaskWithFiles(id,
    deleteFiles ? { deleteFiles: true, downloadDir } : undefined);
  if (!outcome.deleted) return void reply.code(400).send({ error: 'Failed to delete task' });
  await releaseTaskResources(ctx, id, challengeId);
  reply.send({ data: { message: 'Task deleted', filesDeleted: outcome.filesDeleted,
    filesSkipped: outcome.filesSkipped } });
}

async function releaseTaskResources(ctx: TaskRouteContext, id: string, knownChallengeId?: string): Promise<void> {
  const challengeId = knownChallengeId ?? ctx.taskManager.getTaskResult(id)?.challengeDiscoveryId;
  if (challengeId) await ctx.challengeDiscoveryService?.releaseBrowserLease?.(challengeId);
  await ctx.options?.browserLeaseCoordinator?.releaseTask(id);
}

function parseBrowserTarget(value: { mode?: string; workerId?: string; resourceId?: string } | undefined) {
  if (value === undefined) return { mode: 'managed-profile' as const };
  const workerId = value.workerId?.trim();
  if (value.mode === 'managed-profile') {
    return workerId ? { mode: 'managed-profile' as const, workerId } : { mode: 'managed-profile' as const };
  }
  const resourceId = value.resourceId?.trim();
  if (value.mode !== 'existing-tab' || !workerId || !resourceId) {
    return new Error('browserTarget must select managed-profile or provide an existing-tab workerId and resourceId.');
  }
  return { mode: 'existing-tab' as const, workerId, resourceId };
}

function parseExistingTabBrowserTarget(value: unknown): ExistingTabBrowserTarget | Error {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return new Error('an existing-tab Browser Target is required.');
  }
  const target = value as Record<string, unknown>;
  const unknownField = Object.keys(target).find((field) =>
    field !== 'mode' && field !== 'workerId' && field !== 'resourceId');
  if (unknownField) return new Error(`unknown field "${unknownField}".`);
  const workerId = typeof target.workerId === 'string' ? target.workerId.trim() : '';
  const resourceId = typeof target.resourceId === 'string' ? target.resourceId.trim() : '';
  if (target.mode !== 'existing-tab' || !workerId || !resourceId) {
    return new Error('mode must be "existing-tab" and workerId/resourceId are required.');
  }
  return { mode: 'existing-tab', workerId, resourceId };
}
