export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  PARSING_ERROR = 'PARSING_ERROR',
  ADAPTER_ERROR = 'ADAPTER_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  CONFIG_ERROR = 'CONFIG_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SSRF_ERROR = 'SSRF_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
}

export type ErrorAction = 'retry' | 'skip' | 'abort';

export interface RetryStrategy {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
  retryableErrors: ErrorType[];
}

export class ComicError extends Error {
  readonly type: ErrorType;
  readonly recoverable: boolean;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    type: ErrorType,
    recoverable: boolean = false,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'ComicError';
    this.type = type;
    this.recoverable = recoverable;
    this.context = context;
  }

  toString(): string {
    const contextStr = Object.keys(this.context).length > 0
      ? `\n  Context: ${JSON.stringify(this.context, null, 2)}`
      : '';
    return `ComicError [${this.type}] (recoverable: ${this.recoverable}): ${this.message}${contextStr}`;
  }
}

export function formatError(error: unknown): string {
  if (error instanceof ComicError) {
    return error.toString();
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
  }
  return String(error);
}

export function errorToLogObject(error: unknown): Record<string, unknown> {
  if (error instanceof ComicError) {
    return {
      name: error.name,
      type: error.type,
      message: error.message,
      recoverable: error.recoverable,
      context: error.context,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
