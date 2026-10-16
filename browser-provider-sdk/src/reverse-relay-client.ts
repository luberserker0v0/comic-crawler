import WebSocket from 'ws';
import type {
  BrowserProvider,
  BrowserProviderControlRequest,
  BrowserProviderRegistrationRequest,
  BrowserProviderRegistrationResponse,
  BrowserProviderSessionHandle,
  BrowserProviderServiceDiscovery,
} from './contracts';
import { BROWSER_PROVIDER_CONTRACT_VERSION, BROWSER_PROVIDER_DISCOVERY_PATH } from './contracts';

export async function discoverBrowserProviderService(serverUrl: string): Promise<BrowserProviderServiceDiscovery> {
  const response = await fetch(new URL(BROWSER_PROVIDER_DISCOVERY_PATH, serverUrl));
  const body = await response.json() as { data?: BrowserProviderServiceDiscovery; error?: string };
  if (!response.ok || !body.data) throw new Error(body.error ?? `Browser provider discovery failed (${response.status}).`);
  if (body.data.contractVersion !== BROWSER_PROVIDER_CONTRACT_VERSION || body.data.transport !== 'reverse-relay') {
    throw new Error('ComicCrawler returned an unsupported browser provider contract.');
  }
  return body.data;
}

export async function registerBrowserProvider(input: {
  serverUrl: string;
  registration: BrowserProviderRegistrationRequest;
  userId?: string;
  userToken?: string;
}): Promise<BrowserProviderRegistrationResponse> {
  const discovery = await discoverBrowserProviderService(input.serverUrl);
  if (Boolean(input.userId) !== Boolean(input.userToken)) {
    throw new Error('userId and userToken must be provided together.');
  }
  if (discovery.apiSecurityMode === 'token' && (!input.userId || !input.userToken)) {
    throw new Error('The ComicCrawler Server requires a user ID and user API token for Provider registration.');
  }
  const userAuthentication: Record<string, string> = {};
  if (discovery.apiSecurityMode === 'token') {
    userAuthentication['x-comiccrawler-user-id'] = input.userId!;
    userAuthentication.authorization = `Bearer ${input.userToken!}`;
  }
  const response = await fetch(new URL(discovery.endpoints.enroll, input.serverUrl), {
    method: 'POST',
    headers: {
      ...userAuthentication,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input.registration),
  });
  const body = await response.json() as { data?: BrowserProviderRegistrationResponse; error?: string };
  if (!response.ok || !body.data) {
    throw new Error(body.error ?? `Browser provider registration failed (${response.status}).`);
  }
  return body.data;
}

export class ReverseRelayBrowserProviderClient {
  private control?: WebSocket;
  private readonly tunnels = new Set<WebSocket>();
  private discovery?: BrowserProviderServiceDiscovery;

  constructor(private readonly input: {
    serverUrl: string;
    credential: string;
    provider: BrowserProvider;
  }) {}

  async connectOnce(): Promise<void> {
    this.discovery = await discoverBrowserProviderService(this.input.serverUrl);
    const control = this.openSocket(this.discovery.endpoints.controlWebSocket);
    this.control = control;
    await waitForOpen(control);
    control.send(JSON.stringify({ type: 'hello', descriptor: await this.input.provider.describe() }));

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      control.on('message', (data, isBinary) => {
        if (isBinary) return;
        void this.handleControlMessage(control, data.toString()).catch((error) => {
          if (control.readyState === WebSocket.OPEN) {
            control.send(JSON.stringify({ type: 'client-error', error: errorMessage(error) }));
          }
        });
      });
      control.once('close', () => {
        settled = true;
        if (this.control === control) this.control = undefined;
        resolve();
      });
      control.once('error', (error) => {
        if (!settled) reject(error);
      });
    });
  }

  async close(): Promise<void> {
    if (this.control) close(this.control);
    for (const tunnel of this.tunnels) close(tunnel);
    this.tunnels.clear();
    await this.input.provider.close();
  }

  private async handleControlMessage(control: WebSocket, raw: string): Promise<void> {
    const message = JSON.parse(raw) as BrowserProviderControlRequest;
    if (message.type === 'open-tunnel') {
      await this.openTunnel(message.tunnelId, message.sessionId, message.headers);
      return;
    }
    try {
      let data: unknown;
      if (message.type === 'create-session') {
        data = publicHandle(await this.input.provider.createSession(message.request));
      } else if (message.type === 'heartbeat') {
        data = publicHandle(await this.input.provider.heartbeat(message.sessionId, message.ttlSeconds));
      } else if (message.type === 'close-session') {
        await this.input.provider.closeSession(message.sessionId);
      } else {
        return;
      }
      control.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: true, data }));
    } catch (error) {
      control.send(JSON.stringify({ type: 'response', requestId: message.requestId, ok: false, error: errorMessage(error) }));
    }
  }

  private async openTunnel(tunnelId: string, sessionId: string, headers?: Record<string, string>): Promise<void> {
    const session = await this.input.provider.getSession(sessionId);
    if (!session) throw new Error(`Browser session "${sessionId}" was not found.`);
    const relayPath = this.discovery?.endpoints.relayWebSocketTemplate.replace('{tunnelId}', encodeURIComponent(tunnelId));
    if (!relayPath) throw new Error('Browser provider service discovery is unavailable.');
    const relay = this.openSocket(relayPath);
    const browser = new WebSocket(session.localWsEndpoint, { headers });
    this.tunnels.add(relay);
    this.tunnels.add(browser);
    const forget = () => {
      this.tunnels.delete(relay);
      this.tunnels.delete(browser);
    };
    relay.once('close', forget);
    browser.once('close', forget);
    const relayQueue: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
    const browserQueue: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
    const queueRelay = (data: WebSocket.RawData, binary: boolean) => relayQueue.push({ data, binary });
    const queueBrowser = (data: WebSocket.RawData, binary: boolean) => browserQueue.push({ data, binary });
    relay.on('message', queueRelay);
    browser.on('message', queueBrowser);
    await Promise.all([waitForOpen(relay), waitForOpen(browser)]);
    relay.off('message', queueRelay);
    browser.off('message', queueBrowser);
    bridge(relay, browser);
    for (const message of relayQueue) browser.send(message.data, { binary: message.binary });
    for (const message of browserQueue) relay.send(message.data, { binary: message.binary });
  }

  private openSocket(path: string): WebSocket {
    const url = new URL(path, this.input.serverUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(url, { headers: { authorization: `Bearer ${this.input.credential}` } });
  }
}

function publicHandle(handle: BrowserProviderSessionHandle): Omit<BrowserProviderSessionHandle, 'localWsEndpoint'> {
  const { localWsEndpoint: _localWsEndpoint, ...session } = handle;
  return session;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function bridge(left: WebSocket, right: WebSocket): void {
  left.on('message', (data, binary) => right.readyState === WebSocket.OPEN && right.send(data, { binary }));
  right.on('message', (data, binary) => left.readyState === WebSocket.OPEN && left.send(data, { binary }));
  left.on('close', () => close(right));
  right.on('close', () => close(left));
  left.on('error', () => close(right));
  right.on('error', () => close(left));
}

function close(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
