import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserSessionGateway } from '../browser/browser-session-gateway';
import type { EventBus } from '../events/bus';
import type { EventKey } from '../events/types';
import type { ApiSecurityService } from '../security/api-security';

const EVENT_KEYS: EventKey[] = [
  'task:created', 'task:started', 'task:progress', 'task:metadata_extracted', 'task:waiting_for_browser_worker',
  'task:chapter_list_extracted', 'task:paused', 'task:resumed', 'task:waiting_verification',
  'task:browser_target_rebound', 'task:completed', 'task:failed', 'task:cancelled', 'image:downloaded',
  'image:failed', 'chapter:completed', 'adapter:registered', 'config:changed', 'scheduler:triggered',
  'adapter:repair:triggered', 'adapter:repair:started', 'adapter:repair:attempted',
  'adapter:repair:validated', 'adapter:repair:candidate-created', 'adapter:repair:promotion-requested',
  'adapter:repair:promoted', 'adapter:repair:failed', 'adapter:repair:rolled-back',
];

export function setupWebSocket(
  httpServer: HttpServer,
  eventBus: EventBus,
  browserSessionGateway?: BrowserSessionGateway,
  apiSecurity?: ApiSecurityService
): void {
  const eventServer = new WebSocketServer({ noServer: true });
  const browserClientServer = new WebSocketServer({ noServer: true });
  setupEventConnections(eventServer, eventBus);
  httpServer.on('upgrade', (request, socket, head) => handleUpgrade({ request, socket, head,
    eventServer, browserClientServer, browserSessionGateway, apiSecurity }));
}

function handleUpgrade(input: { request: any; socket: any; head: Buffer; eventServer: WebSocketServer;
  browserClientServer: WebSocketServer; browserSessionGateway?: BrowserSessionGateway;
  apiSecurity?: ApiSecurityService }): void {
  const path = new URL(input.request.url ?? '/', 'http://localhost').pathname;
  if (path === '/ws') return upgradeEventSocket(input);
  if (input.browserSessionGateway && path === '/api/browser-clients/connect') {
    input.browserClientServer.handleUpgrade(input.request, input.socket, input.head,
      (webSocket) => input.browserSessionGateway!.acceptConnection(webSocket));
    return;
  }
  input.socket.destroy();
}

function upgradeEventSocket(input: Parameters<typeof handleUpgrade>[0]): void {
  const authentication = input.apiSecurity?.authenticate(input.request.headers);
  if (authentication && !authentication.ok) return rejectUpgrade(input.socket, 401, 'Unauthorized');
  if (authentication?.ok && input.apiSecurity
    && !input.apiSecurity.hasPermission(authentication.principal, 'system:read')) {
    return rejectUpgrade(input.socket, 403, 'Forbidden');
  }
  input.eventServer.handleUpgrade(input.request, input.socket, input.head,
    (webSocket) => input.eventServer.emit('connection', webSocket, input.request));
}

function rejectUpgrade(socket: any, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function setupEventConnections(wss: WebSocketServer, eventBus: EventBus): void {
  const clients = new Set<WebSocket>();
  const subscriptions = new Map<WebSocket, Set<EventKey>>();
  wss.on('connection', (ws: WebSocket) => registerEventClient(ws, clients, subscriptions));
  for (const event of EVENT_KEYS) eventBus.on(event,
    (payload) => broadcastEvent(event, payload, clients, subscriptions));
}

function registerEventClient(ws: WebSocket, clients: Set<WebSocket>,
  subscriptions: Map<WebSocket, Set<EventKey>>): void {
  clients.add(ws);
  subscriptions.set(ws, new Set());
  ws.on('message', (data, binary) => handleSubscriptionMessage(ws, data, binary, subscriptions));
  ws.on('close', () => { clients.delete(ws); subscriptions.delete(ws); });
}

function handleSubscriptionMessage(ws: WebSocket, data: any, binary: boolean,
  subscriptions: Map<WebSocket, Set<EventKey>>): void {
  if (binary) return;
  try {
    const message = JSON.parse(data.toString()) as { type?: string; event?: EventKey };
    const selected = subscriptions.get(ws);
    if (message.type === 'subscribe' && message.event) selected?.add(message.event);
    else if (message.type === 'unsubscribe' && message.event) selected?.delete(message.event);
  } catch { ws.send(JSON.stringify({ error: 'Invalid message format' })); }
}

function broadcastEvent(event: EventKey, payload: unknown, clients: Set<WebSocket>,
  subscriptions: Map<WebSocket, Set<EventKey>>): void {
  const message = JSON.stringify({ event, data: payload });
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const selected = subscriptions.get(client);
    if (!selected?.size || selected.has(event)) client.send(message);
  }
}
