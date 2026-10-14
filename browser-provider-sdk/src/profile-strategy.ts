import type { BrowserProviderCapabilities } from './contracts';

export type BrowserProfileKind = 'ephemeral';

export interface BrowserProfileHandle {
  localWsEndpoint: string;
  runtimeVersion: string;
  close(): Promise<void>;
}

export abstract class BrowserProfileStrategy {
  abstract readonly kind: BrowserProfileKind;

  abstract get capabilities(): BrowserProviderCapabilities;

  abstract launch(): Promise<BrowserProfileHandle>;

  async close(handle: BrowserProfileHandle): Promise<void> {
    await handle.close();
  }
}
