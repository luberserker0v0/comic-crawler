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
  if (error instanceof BrowserClientError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (isAbortError(error)) {
    return {
      code: 'CANCELLED',
      message: 'Browser operation was cancelled.',
      retryable: false,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
