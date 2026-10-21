import { describe, it, expect, beforeEach } from '@jest/globals';
import { ErrorHandler, RetryHandler, ComicError, ErrorType } from '../../../src/error';

let errorHandler: ErrorHandler;

describe('ErrorHandler', () => {
  ErrorHandlerTestGroup1();
});

let retryHandler: RetryHandler;

describe('RetryHandler', () => {
  RetryHandlerTestGroup1();
});

function RetryHandlerTestGroup1(): void {
  beforeEach(RetryHandlerTestScenario1);
  it('should succeed on first try', RetryHandlerTestShouldSucceedOnFirstTry);
  it('should retry on failure', RetryHandlerTestShouldRetryOnFailure);
  it('should throw after max retries', RetryHandlerTestShouldThrowAfterMaxRetries);
  it('should not retry non-retryable errors', RetryHandlerTestShouldNotRetryNonRetryableErrors);
}

function RetryHandlerTestScenario1() {
    retryHandler = new RetryHandler({ maxRetries: 2, delayMs: 10 });
}

async function RetryHandlerTestShouldSucceedOnFirstTry() {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await retryHandler.executeWithRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
}

async function RetryHandlerTestShouldRetryOnFailure() {
    const fn = jest.fn()
        .mockRejectedValueOnce(new ComicError('Fail', ErrorType.NETWORK_ERROR, true))
        .mockResolvedValue('success');
    const result = await retryHandler.executeWithRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
}

async function RetryHandlerTestShouldThrowAfterMaxRetries() {
    const fn = jest.fn().mockRejectedValue(new ComicError('Fail', ErrorType.NETWORK_ERROR, true));
    await expect(retryHandler.executeWithRetry(fn)).rejects.toThrow('Fail');
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
}

async function RetryHandlerTestShouldNotRetryNonRetryableErrors() {
    const fn = jest.fn().mockRejectedValue(new ComicError('Fail', ErrorType.VALIDATION_ERROR, false));
    await expect(retryHandler.executeWithRetry(fn)).rejects.toThrow('Fail');
    expect(fn).toHaveBeenCalledTimes(1);
}

function ErrorHandlerTestGroup1(): void {
  beforeEach(ErrorHandlerTestScenario1);
  it('should convert unknown error to ComicError', ErrorHandlerTestShouldConvertUnknownErrorToComicError);
  it('should pass through existing ComicError', ErrorHandlerTestShouldPassThroughExistingComicError);
  it('should determine correct actions', ErrorHandlerTestShouldDetermineCorrectActions);
  it('should log recent errors', ErrorHandlerTestShouldLogRecentErrors);
  it('should clear errors', ErrorHandlerTestShouldClearErrors);
}

function ErrorHandlerTestScenario1() {
    errorHandler = new ErrorHandler();
}

function ErrorHandlerTestShouldConvertUnknownErrorToComicError() {
    const error = new Error('Network failed');
    const comicError = errorHandler.handle(error);
    expect(comicError).toBeInstanceOf(ComicError);
    expect(comicError.message).toBe('Network failed');
    expect(comicError.type).toBe('NETWORK_ERROR');
    expect(comicError.recoverable).toBe(true);
}

function ErrorHandlerTestShouldPassThroughExistingComicError() {
    const original = new ComicError('Test', ErrorType.PARSING_ERROR, false);
    const result = errorHandler.handle(original);
    expect(result).toBe(original);
}

function ErrorHandlerTestShouldDetermineCorrectActions() {
    const networkError = new ComicError('Net', ErrorType.NETWORK_ERROR, true);
    const validationError = new ComicError('Val', ErrorType.VALIDATION_ERROR, false);
    const configError = new ComicError('Cfg', ErrorType.CONFIG_ERROR, false);
    expect(errorHandler.getAction(networkError)).toBe('retry');
    expect(errorHandler.getAction(validationError)).toBe('abort');
    expect(errorHandler.getAction(configError)).toBe('abort');
}

function ErrorHandlerTestShouldLogRecentErrors() {
    errorHandler.handle(new Error('Test 1'));
    errorHandler.handle(new Error('Test 2'));
    const logs = errorHandler.getRecentErrors();
    expect(logs).toHaveLength(2);
    expect(logs[0].error.message).toBe('Test 1');
    expect(logs[1].error.message).toBe('Test 2');
}

function ErrorHandlerTestShouldClearErrors() {
    errorHandler.handle(new Error('Test'));
    errorHandler.clearErrors();
    expect(errorHandler.getRecentErrors()).toHaveLength(0);
}
