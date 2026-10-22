import type { Logger } from '../utils/logger';
import { errorToLogObject } from '../error/types';

interface StoppableServer {
  stop: () => Promise<void>;
}

interface DisposableResource {
  dispose: () => Promise<void>;
}

interface ShutdownDependencies {
  server: StoppableServer;
  storage?: DisposableResource;
  logger: Logger;
  timeoutMs?: number;
  exit?: (code: number) => never;
}

interface ShutdownRequest {
  reason: string;
  exitCode: number;
  signal?: NodeJS.Signals;
  error?: unknown;
}

interface ShutdownRuntime extends ShutdownDependencies {
  timeoutMs: number;
  exit: (code: number) => never;
}

export interface GracefulShutdownManager {
  shutdown: (request: ShutdownRequest) => Promise<void>;
  register: () => void;
}

async function flushLogger(logger: Logger): Promise<void> {
  if (typeof logger.flush !== 'function') {
    return;
  }

  await new Promise<void>((resolve) => {
    logger.flush(() => resolve());
  });
}

export function createGracefulShutdownManager(dependencies: ShutdownDependencies): GracefulShutdownManager {
  const runtime: ShutdownRuntime = { ...dependencies, timeoutMs: dependencies.timeoutMs ?? 10_000,
    exit: dependencies.exit ?? ((code: number) => process.exit(code)) };
  let pendingShutdown: Promise<void> | null = null;
  const shutdown = async (request: ShutdownRequest): Promise<void> => {
    if (!pendingShutdown) pendingShutdown = performShutdown(runtime, request);
    return pendingShutdown;
  };
  return { shutdown, register: () => registerShutdownHandlers(shutdown) };
}

async function performShutdown(runtime: ShutdownRuntime, request: ShutdownRequest): Promise<void> {
  const timer = createForceExitTimer(runtime, request);
  try {
    logShutdownStart(runtime.logger, request);
    await runtime.server.stop();
    await runtime.storage?.dispose();
    runtime.logger.info({ reason: request.reason }, 'Graceful shutdown completed');
    clearTimeout(timer);
    await flushLogger(runtime.logger);
    runtime.exit(request.exitCode);
  } catch (error) {
    await failShutdown(runtime, request, timer, error);
  }
}

function createForceExitTimer(runtime: ShutdownRuntime, request: ShutdownRequest): NodeJS.Timeout {
  const timer = setTimeout(() => {
    runtime.logger.error({ reason: request.reason, signal: request.signal,
      timeoutMs: runtime.timeoutMs }, 'Forced process exit because graceful shutdown timed out');
    void flushLogger(runtime.logger).finally(() => runtime.exit(1));
  }, runtime.timeoutMs);
  timer.unref();
  return timer;
}

function logShutdownStart(logger: Logger, request: ShutdownRequest): void {
  if (request.error) logger.fatal({ reason: request.reason, signal: request.signal,
    error: errorToLogObject(request.error) }, 'Shutting down after fatal process event');
  else logger.info({ reason: request.reason, signal: request.signal }, 'Starting graceful shutdown');
}

async function failShutdown(runtime: ShutdownRuntime, request: ShutdownRequest,
  timer: NodeJS.Timeout, error: unknown): Promise<never> {
  clearTimeout(timer);
  runtime.logger.fatal({ reason: request.reason, signal: request.signal,
    error: errorToLogObject(error) }, 'Graceful shutdown failed');
  await flushLogger(runtime.logger);
  runtime.exit(1);
}

function registerShutdownHandlers(shutdown: GracefulShutdownManager['shutdown']): void {
  process.once('SIGINT', () => void shutdown({ reason: 'SIGINT received', signal: 'SIGINT', exitCode: 0 }));
  process.once('SIGTERM', () => void shutdown({ reason: 'SIGTERM received', signal: 'SIGTERM', exitCode: 0 }));
  process.once('uncaughtException', (error) => void shutdown({ reason: 'uncaughtException', error, exitCode: 1 }));
  process.once('unhandledRejection', (error) => void shutdown({ reason: 'unhandledRejection', error, exitCode: 1 }));
}
