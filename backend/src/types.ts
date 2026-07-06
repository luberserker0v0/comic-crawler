export type {
  IStorage,
  WriteOperation,
  JsonFileStoreOptions,
} from './storage/types';

export type {
  ErrorType,
  ErrorAction,
  RetryStrategy,
  ComicError,
} from './error/types';

export type {
  ExtractionContext,
  ExtractionResult,
  IExtractionStrategy,
  SelectorConfig,
} from './crawler/extraction/types';

export type { ILocator } from './crawler/locator';
export type { BrowserPoolConfig, BrowserInstance, BrowserPoolStats } from './crawler/types';
export type { HtmlParser } from './crawler/html-parser';
