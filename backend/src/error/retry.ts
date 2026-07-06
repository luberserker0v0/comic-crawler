import { ComicError, ErrorType } from './types';
import type { RetryStrategy } from './types';

const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  retryableErrors: [ErrorType.NETWORK_ERROR, ErrorType.DOWNLOAD_FAILED],
};

export class RetryHandler {
  private strategy: RetryStrategy;

  constructor(strategy?: Partial<RetryStrategy>) {
    this.strategy = { ...DEFAULT_RETRY_STRATEGY, ...strategy };
  }

  isRetryable(error: ComicError): boolean {
    return this.strategy.retryableErrors.includes(error.type);
  }

  async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: ComicError | undefined;

    for (let attempt = 0; attempt <= this.strategy.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof ComicError ? error : this.wrapError(error);

        if (!this.isRetryable(lastError) || attempt === this.strategy.maxRetries) {
          throw lastError;
        }

        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private calculateDelay(attempt: number): number {
    return this.strategy.delayMs * Math.pow(this.strategy.backoffMultiplier, attempt);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private wrapError(error: unknown): ComicError {
    if (error instanceof ComicError) return error;
    return new ComicError(
      error instanceof Error ? error.message : String(error),
      ErrorType.NETWORK_ERROR,
      false,
      { originalError: error }
    );
  }
}
