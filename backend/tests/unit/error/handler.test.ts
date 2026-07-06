import { describe, it, expect, beforeEach } from '@jest/globals';
import { ErrorHandler, RetryHandler, ComicError, ErrorType } from '../../../src/error';

describe('ErrorHandler', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = new ErrorHandler();
  });

  it('should convert unknown error to ComicError', () => {
    const error = new Error('Network failed');
    const comicError = handler.handle(error);

    expect(comicError).toBeInstanceOf(ComicError);
    expect(comicError.message).toBe('Network failed');
    expect(comicError.type).toBe('NETWORK_ERROR');
    expect(comicError.recoverable).toBe(true);
  });

  it('should pass through existing ComicError', () => {
    const original = new ComicError('Test', ErrorType.PARSING_ERROR, false);
    const result = handler.handle(original);

    expect(result).toBe(original);
  });

  it('should determine correct actions', () => {
    const networkError = new ComicError('Net', ErrorType.NETWORK_ERROR, true);
    const validationError = new ComicError('Val', ErrorType.VALIDATION_ERROR, false);
    const configError = new ComicError('Cfg', ErrorType.CONFIG_ERROR, false);

    expect(handler.getAction(networkError)).toBe('retry');
    expect(handler.getAction(validationError)).toBe('abort');
    expect(handler.getAction(configError)).toBe('abort');
  });

  it('should log recent errors', () => {
    handler.handle(new Error('Test 1'));
    handler.handle(new Error('Test 2'));

    const logs = handler.getRecentErrors();
    expect(logs).toHaveLength(2);
    expect(logs[0].error.message).toBe('Test 1');
    expect(logs[1].error.message).toBe('Test 2');
  });

  it('should clear errors', () => {
    handler.handle(new Error('Test'));
    handler.clearErrors();

    expect(handler.getRecentErrors()).toHaveLength(0);
  });
});

describe('RetryHandler', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({ maxRetries: 2, delayMs: 10 });
  });

  it('should succeed on first try', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await handler.executeWithRetry(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new ComicError('Fail', ErrorType.NETWORK_ERROR, true))
      .mockResolvedValue('success');

    const result = await handler.executeWithRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries', async () => {
    const fn = jest.fn().mockRejectedValue(new ComicError('Fail', ErrorType.NETWORK_ERROR, true));

    await expect(handler.executeWithRetry(fn)).rejects.toThrow('Fail');
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should not retry non-retryable errors', async () => {
    const fn = jest.fn().mockRejectedValue(new ComicError('Fail', ErrorType.VALIDATION_ERROR, false));

    await expect(handler.executeWithRetry(fn)).rejects.toThrow('Fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
