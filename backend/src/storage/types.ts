export interface IStorage {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  exists(key: string): Promise<boolean>;
}

export interface WriteOperation {
  key: string;
  value: unknown;
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface JsonFileStoreOptions {
  basePath: string;
  flushInterval?: number;
  maxBufferSize?: number;
}
