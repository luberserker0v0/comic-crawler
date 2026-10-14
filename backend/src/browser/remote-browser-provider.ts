import { chromium, type Browser } from 'playwright';

export interface RemoteBrowserConnectionOptions {
  wsEndpoint?: string;
  timeout?: number;
  exposeNetwork?: string;
  headers?: Record<string, string>;
}

export function requireRemoteBrowserEndpoint(options?: RemoteBrowserConnectionOptions): string {
  const value = options?.wsEndpoint?.trim();
  if (!value) {
    throw new Error(
      'No active Browser Provider session is available. Enroll and connect a provider, then create a session.'
    );
  }

  const endpoint = new URL(value);
  if (endpoint.protocol !== 'ws:' && endpoint.protocol !== 'wss:') {
    throw new Error('Remote Playwright endpoint must use ws:// or wss://.');
  }
  return endpoint.href;
}

export async function connectRemoteBrowser(options?: RemoteBrowserConnectionOptions): Promise<Browser> {
  const wsEndpoint = requireRemoteBrowserEndpoint(options);
  return chromium.connect(wsEndpoint, {
    timeout: options?.timeout ?? 30000,
    exposeNetwork: options?.exposeNetwork,
    headers: options?.headers,
  });
}
