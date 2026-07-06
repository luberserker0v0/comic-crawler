import { describe, it, expect, jest } from '@jest/globals';
import { createGracefulShutdownManager } from '../../../src/bootstrap/graceful-shutdown';

function createLoggerMock() {
  return {
    info: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    flush: jest.fn((callback: () => void) => callback()),
  } as any;
}

describe('createGracefulShutdownManager', () => {
  it('should stop the server, dispose storage, flush logs, and exit', async () => {
    const server = { stop: jest.fn(async () => undefined) };
    const storage = { dispose: jest.fn(async () => undefined) };
    const logger = createLoggerMock();
    const exit = jest.fn(() => undefined as never);
    const manager = createGracefulShutdownManager({ server, storage, logger, exit });

    await manager.shutdown({ reason: 'SIGTERM received', signal: 'SIGTERM', exitCode: 0 });

    expect(server.stop).toHaveBeenCalledTimes(1);
    expect(storage.dispose).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalled();
    expect(logger.flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('should only execute shutdown once when called concurrently', async () => {
    const server = { stop: jest.fn(async () => undefined) };
    const storage = { dispose: jest.fn(async () => undefined) };
    const logger = createLoggerMock();
    const exit = jest.fn(() => undefined as never);
    const manager = createGracefulShutdownManager({ server, storage, logger, exit });

    await Promise.all([
      manager.shutdown({ reason: 'SIGINT received', signal: 'SIGINT', exitCode: 0 }),
      manager.shutdown({ reason: 'SIGTERM received', signal: 'SIGTERM', exitCode: 0 }),
    ]);

    expect(server.stop).toHaveBeenCalledTimes(1);
    expect(storage.dispose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('should log fatal details for fatal process events', async () => {
    const server = { stop: jest.fn(async () => undefined) };
    const logger = createLoggerMock();
    const exit = jest.fn(() => undefined as never);
    const manager = createGracefulShutdownManager({ server, logger, exit });

    await manager.shutdown({ reason: 'uncaughtException', error: new Error('boom'), exitCode: 1 });

    expect(logger.fatal).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
