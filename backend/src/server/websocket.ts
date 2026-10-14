import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserProviderRegistry } from '../browser/provider-registry';
import type { EventBus } from '../events/bus';
import type { EventKey } from '../events/types';

export function setupWebSocket(
  httpServer: HttpServer,
  eventBus: EventBus,
  browserProviderRegistry?: BrowserProviderRegistry
): void {
  const eventServer = new WebSocketServer({ noServer: true });
  const providerServer = new WebSocketServer({ noServer: true });
  setupEventConnections(eventServer, eventBus);

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws') {
      eventServer.handleUpgrade(request, socket, head, (webSocket) => {
        eventServer.emit('connection', webSocket, request);
      });
      return;
    }
    if (browserProviderRegistry && isBrowserProviderPath(url.pathname)) {
      providerServer.handleUpgrade(request, socket, head, (webSocket) => {
        acceptBrowserProviderSocket(browserProviderRegistry, request, url, webSocket);
      });
      return;
    }
    socket.destroy();
  });
}

function setupEventConnections(wss: WebSocketServer, eventBus: EventBus): void {
  const clients = new Set<WebSocket>();
  const subscriptions = new Map<WebSocket, Set<EventKey>>();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    subscriptions.set(ws, new Set());
    ws.on('message', (data, binary) => {
      if (binary) return;
      try {
        const message = JSON.parse(data.toString()) as { type?: string; event?: EventKey };
        const subs = subscriptions.get(ws);
        if (message.type === 'subscribe' && message.event) subs?.add(message.event);
        else if (message.type === 'unsubscribe' && message.event) subs?.delete(message.event);
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      subscriptions.delete(ws);
    });
  });

  const events: EventKey[] = [
    'task:created', 'task:started', 'task:progress', 'task:metadata_extracted',
    'task:chapter_list_extracted', 'task:paused', 'task:resumed', 'task:waiting_verification',
    'task:completed', 'task:failed', 'task:cancelled', 'image:downloaded', 'image:failed',
    'chapter:completed', 'adapter:registered', 'config:changed', 'scheduler:triggered',
    'adapter:repair:triggered', 'adapter:repair:started', 'adapter:repair:attempted',
    'adapter:repair:validated', 'adapter:repair:candidate-created',
    'adapter:repair:promotion-requested', 'adapter:repair:promoted',
    'adapter:repair:failed', 'adapter:repair:rolled-back',
  ];

  for (const event of events) {
    eventBus.on(event, (payload) => {
      const message = JSON.stringify({ event, data: payload });
      for (const client of clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        const subs = subscriptions.get(client);
        if (!subs || subs.size === 0 || subs.has(event)) client.send(message);
      }
    });
  }
}

function acceptBrowserProviderSocket(
  registry: BrowserProviderRegistry,
  request: IncomingMessage,
  url: URL,
  socket: WebSocket
): void {
  if (url.pathname === '/api/browser-providers/connect') {
    const record = registry.authenticateCredential(bearerToken(request));
    if (!record) return socket.close(4003, 'Browser provider credential is invalid.');
    registry.acceptControlConnection(record, socket);
    return;
  }
  const relay = url.pathname.match(/^\/api\/browser-providers\/relay\/([^/]+)$/);
  if (relay) {
    const record = registry.authenticateCredential(bearerToken(request));
    if (!record) return socket.close(4003, 'Browser provider credential is invalid.');
    registry.acceptRelayConnection(record, decodeURIComponent(relay[1]!), socket);
    return;
  }
  const browser = url.pathname.match(/^\/api\/browser-providers\/sessions\/([^/]+)\/connect$/);
  if (browser) {
    registry.acceptBrowserConnection(
      decodeURIComponent(browser[1]!),
      url.searchParams.get('ticket') ?? undefined,
      socket,
      playwrightHeaders(request)
    );
    return;
  }
  socket.close(4004, 'Unknown browser provider endpoint.');
}

function bearerToken(request: IncomingMessage): string | undefined {
  return request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function playwrightHeaders(request: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ['x-playwright-browser', 'x-playwright-proxy', 'user-agent']) {
    const value = request.headers[name];
    if (typeof value === 'string') result[name] = value;
  }
  return result;
}

function isBrowserProviderPath(pathname: string): boolean {
  return pathname === '/api/browser-providers/connect'
    || pathname.startsWith('/api/browser-providers/relay/')
    || /^\/api\/browser-providers\/sessions\/[^/]+\/connect$/.test(pathname);
}
