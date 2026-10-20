import type { BrowserCommandError, BrowserCommandErrorCode } from './contracts';

export class BrowserClientError extends Error {
  constructor(
    message: string,
    readonly code: BrowserCommandErrorCode = 'INTERNAL_ERROR',
    readonly retryable = false
  ) {
    super(message);
    this.name = 'BrowserClientError';
  }
}

export function toBrowserCommandError(error: unknown): BrowserCommandError {
  if (error instanceof BrowserClientError) return clientCommandError(error);
  if (isAbortError(error)) return cancelledCommandError();
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function clientCommandError(error: BrowserClientError): BrowserCommandError {
  return { code: error.code, message: error.message, retryable: error.retryable };
}

function cancelledCommandError(): BrowserCommandError {
  return { code: 'CANCELLED', message: 'Browser operation was cancelled.', retryable: false };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
