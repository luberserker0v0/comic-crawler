import type { AdapterRegistry } from '../adapter/registry';
import type { BrowserWorkerLease, BrowserWorkerLeaseCoordinator } from '../browser/browser-worker-lease-coordinator';
import type { ChallengeDiscoveryService } from '../challenge';
import type { ConfigManager } from '../config/manager';
import type { CrawlerEngine } from '../crawler/engine';
import { ComicError, ErrorType, errorToLogObject } from '../error/types';
import type { EventBus } from '../events/bus';
import { TaskDeferredError } from '../scheduler';
import type { TaskDefinition, TaskManager } from '../task/manager';
import type { TaskItem } from '../task/types';

interface CrawlTaskExecutorDependencies {
  adapterRegistry: AdapterRegistry;
  configManager: ConfigManager;
  browserLeaseCoordinator: BrowserWorkerLeaseCoordinator;
  crawlerEngine: CrawlerEngine;
  eventBus: EventBus;
  challengeDiscoveryService: ChallengeDiscoveryService;
  getTaskManager(): TaskManager;
}

interface ExecutionState { lease?: BrowserWorkerLease; retainLease: boolean; reconnectAttempts: number }

export function createCrawlTaskExecutor(deps: CrawlTaskExecutorDependencies) {
  return (task: TaskItem<TaskDefinition>, signal: AbortSignal) => executeCrawlTask(deps, task, signal);
}

async function executeCrawlTask(
  deps: CrawlTaskExecutorDependencies, task: TaskItem<TaskDefinition>, signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  const adapter = deps.adapterRegistry.get(task.data.adapterId);
  if (!adapter) throw new ComicError(
    `Adapter "${task.data.adapterId}" not found`, ErrorType.ADAPTER_ERROR);
  const state: ExecutionState = { retainLease: false, reconnectAttempts: 0 };
  try {
    state.lease = await acquireTaskLease(deps, task, signal);
    await crawlWithReconnect(deps, task, adapter as any, state, signal);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    await handleCrawlError(deps, task, adapter.id, state, error);
  } finally {
    if (!state.retainLease) await state.lease?.release();
  }
}

async function acquireTaskLease(
  deps: CrawlTaskExecutorDependencies, task: TaskItem<TaskDefinition>, signal: AbortSignal
): Promise<BrowserWorkerLease> {
  signal.throwIfAborted();
  const browser = (await deps.configManager.get()).browser;
  const lease = await deps.browserLeaseCoordinator.tryAcquire({ taskId: task.id,
    ownerUserId: task.data.ownerUserId ?? 'public', target: task.data.browserTarget,
    initialUrl: task.data.browserTargetUrl ?? task.data.url });
  if (!lease) await deferForBrowserWorker(deps.getTaskManager(), task, browser.workerWaitTimeoutMs);
  signal.throwIfAborted();
  await deps.getTaskManager().markBrowserWorkerAcquired(task.id);
  return lease!;
}

async function deferForBrowserWorker(
  manager: TaskManager, task: TaskItem<TaskDefinition>, timeoutMs = 30 * 60 * 1000
): Promise<never> {
  const target = task.data.browserTarget;
  const message = target?.mode === 'existing-tab' || target?.workerId
    ? `Waiting for browser worker "${target.workerId}".`
    : 'Waiting for an available managed-profile browser worker.';
  await manager.markWaitingForBrowserWorker(task.id, message);
  const startedAt = Date.parse(task.data.browserWaitStartedAt ?? new Date().toISOString());
  const remaining = timeoutMs - (Date.now() - startedAt);
  if (remaining <= 0) throw new Error(message.replace(/^Waiting/, 'Timed out waiting'));
  throw new TaskDeferredError(message, Math.min(5_000, remaining));
}

async function crawlWithReconnect(
  deps: CrawlTaskExecutorDependencies, task: TaskItem<TaskDefinition>, adapter: any,
  state: ExecutionState, signal: AbortSignal
): Promise<void> {
  while (true) {
    signal.throwIfAborted();
    try {
      await runCrawler(deps, task, adapter, state.lease!, signal);
      return;
    } catch (error) {
      if (!isBrowserTransportDisconnect(error) || state.reconnectAttempts >= 3) throw error;
      state.reconnectAttempts += 1;
      await waitForTaskReconnect(deps, task, state, error, signal);
    }
  }
}

function runCrawler(
  deps: CrawlTaskExecutorDependencies, task: TaskItem<TaskDefinition>, adapter: any,
  lease: BrowserWorkerLease, signal: AbortSignal
): Promise<unknown> {
  const manager = deps.getTaskManager();
  return deps.crawlerEngine.crawl(adapter, task.data.url, { chapters: task.data.chapters,
    chapterUrls: task.data.chapterUrls, taskId: task.id, browserSessionId: lease.sessionId,
    signal,
    checkpoint: manager.getCheckpoint(task.id),
    onCheckpoint: (checkpoint) => manager.updateCheckpoint(task.id, checkpoint) });
}

async function waitForTaskReconnect(
  deps: CrawlTaskExecutorDependencies, task: TaskItem<TaskDefinition>, state: ExecutionState,
  error: unknown, signal: AbortSignal
): Promise<void> {
  const message = `Browser worker disconnected; waiting to resume (${state.reconnectAttempts}/3).`;
  await deps.getTaskManager().markWaitingForBrowserWorker(task.id, message);
  if (await deps.browserLeaseCoordinator.waitForReconnect(state.lease!, 120_000, signal)) return;
  signal.throwIfAborted();
  if (browserTargetChanged(task, state.lease!))
    throw new TaskDeferredError('Browser Target was explicitly rebound; restarting the task.', 1);
  throw error;
}

function browserTargetChanged(task: TaskItem<TaskDefinition>, lease: BrowserWorkerLease): boolean {
  const target = task.data.browserTarget;
  return target?.workerId !== lease.workerId || target?.mode === 'existing-tab'
    && lease.source.type === 'existing-resource' && target.resourceId !== lease.source.resourceId;
}

async function handleCrawlError(
  deps: CrawlTaskExecutorDependencies, task: TaskItem<TaskDefinition>, adapterId: string,
  state: ExecutionState, error: unknown
): Promise<never> {
  if (!isHumanVerificationRequiredError(error)) throw error;
  const url = verificationUrl(error, task);
  emitVerificationProgress(deps.eventBus, task.id);
  state.retainLease = true;
  const job = await deps.challengeDiscoveryService.createDeferred({ url, browserLease: state.lease,
    ownerUserId: task.data.ownerUserId, browserTarget: task.data.browserTarget });
  state.lease = undefined;
  throw new ComicError(
    `Human verification is required before crawling can continue. Challenge discovery job: ${job.id}`,
    ErrorType.AUTH_ERROR, false, { adapterId, url, challengeDiscoveryId: job.id,
      challengeStatus: job.status, originalError: errorToLogObject(error) });
}

function verificationUrl(error: unknown, task: TaskItem<TaskDefinition>): string {
  const errorUrl = error instanceof ComicError && typeof error.context.url === 'string'
    ? error.context.url : undefined;
  return errorUrl ?? task.data.chapterUrls?.[0] ?? task.data.url;
}

function emitVerificationProgress(eventBus: EventBus, taskId: string): void {
  const detail = 'human verification detected; queued verification handoff';
  eventBus.emit('task:progress', { taskId, progress: { totalImages: 0, completedImages: 0,
    failedImages: 0, stage: 'verification', stageDetail: detail, currentChapter: detail } });
}

function isHumanVerificationRequiredError(error: unknown): boolean {
  if (error instanceof ComicError) return hasHumanVerificationContext(error.context);
  const message = error instanceof Error ? error.message : String(error);
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access/i.test(message);
}

function hasHumanVerificationContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const context = value as Record<string, unknown>;
  if (context.antiBotChallenge === true || context.challengeType === 'access_blocked'
    || context.humanVerificationProfileUnavailable === true) return true;
  return Object.values(context).some((entry) => hasHumanVerificationContext(entry));
}

function isBrowserTransportDisconnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /websocket|browser has been closed|browser closed|connection closed|target page, context or browser has been closed|econnreset|socket hang up/i.test(message);
}
