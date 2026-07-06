import { ComicError, ErrorType, type ErrorAction } from './types';

export class ErrorHandler {
  private errorLog: Array<{
    timestamp: Date;
    error: ComicError;
    action: ErrorAction;
  }> = [];

  private maxLogSize = 1000;

  handle(error: unknown, context?: Record<string, unknown>): ComicError {
    const comicError = this.toComicError(error, context);
    const action = this.determineAction(comicError);

    this.logError(comicError, action);

    return comicError;
  }

  getAction(error: ComicError): ErrorAction {
    return this.determineAction(error);
  }

  getRecentErrors(limit = 10): Array<{ timestamp: Date; error: ComicError; action: ErrorAction }> {
    return this.errorLog.slice(-limit);
  }

  clearErrors(): void {
    this.errorLog = [];
  }

  private toComicError(error: unknown, context?: Record<string, unknown>): ComicError {
    if (error instanceof ComicError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const type = this.classifyError(error);

    return new ComicError(message, type, true, context);
  }

  private classifyError(error: unknown): ErrorType {
    if (error instanceof Error) {
      const name = error.name.toLowerCase();
      if (name.includes('network') || name.includes('fetch')) return ErrorType.NETWORK_ERROR;
      if (name.includes('parse') || name.includes('syntax')) return ErrorType.PARSING_ERROR;
      if (name.includes('auth') || name.includes('permission')) return ErrorType.AUTH_ERROR;
    }
    return ErrorType.NETWORK_ERROR;
  }

  private determineAction(error: ComicError): ErrorAction {
    if (error.recoverable) return 'retry';
    if (error.type === ErrorType.VALIDATION_ERROR) return 'abort';
    if (error.type === ErrorType.CONFIG_ERROR) return 'abort';
    return 'skip';
  }

  private logError(error: ComicError, action: ErrorAction): void {
    this.errorLog.push({
      timestamp: new Date(),
      error,
      action,
    });

    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
  }
}
