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
  const {
    server,
    storage,
    logger,
    timeoutMs = 10_000,
    exit = (code: number) => process.exit(code),
  } = dependencies;

  let pendingShutdown: Promise<void> | null = null;

  const shutdown = async (request: ShutdownRequest): Promise<void> => {
    if (pendingShutdown) {
      return pendingShutdown;
    }

    pendingShutdown = (async () => {
      const forceExitTimer = setTimeout(() => {
        logger.error(
          { reason: request.reason, signal: request.signal, timeoutMs },
          'Forced process exit because graceful shutdown timed out'
        );
        void flushLogger(logger).finally(() => exit(1));
      }, timeoutMs);
      forceExitTimer.unref();

      try {
        if (request.error) {
          logger.fatal(
            {
              reason: request.reason,
              signal: request.signal,
              error: errorToLogObject(request.error),
            },
            'Shutting down after fatal process event'
          );
        } else {
          logger.info(
            {
              reason: request.reason,
              signal: request.signal,
            },
            'Starting graceful shutdown'
          );
        }

        await server.stop();
        await storage?.dispose();

        logger.info({ reason: request.reason }, 'Graceful shutdown completed');
        clearTimeout(forceExitTimer);
        await flushLogger(logger);
        exit(request.exitCode);
      } catch (shutdownError) {
        clearTimeout(forceExitTimer);
        logger.fatal(
          {
            reason: request.reason,
            signal: request.signal,
            error: errorToLogObject(shutdownError),
          },
          'Graceful shutdown failed'
        );
        await flushLogger(logger);
        exit(1);
      }
    })();

    return pendingShutdown;
  };

  const register = () => {
    process.once('SIGINT', () => {
      void shutdown({ reason: 'SIGINT received', signal: 'SIGINT', exitCode: 0 });
    });

    process.once('SIGTERM', () => {
      void shutdown({ reason: 'SIGTERM received', signal: 'SIGTERM', exitCode: 0 });
    });

    process.once('uncaughtException', (error) => {
      void shutdown({ reason: 'uncaughtException', error, exitCode: 1 });
    });

    process.once('unhandledRejection', (error) => {
      void shutdown({ reason: 'unhandledRejection', error, exitCode: 1 });
    });
  };

  return { shutdown, register };
}
