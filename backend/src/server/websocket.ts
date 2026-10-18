import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BrowserSessionGateway } from '../browser/browser-session-gateway';
import type { EventBus } from '../events/bus';
import type { EventKey } from '../events/types';
import type { ApiSecurityService } from '../security/api-security';

export function setupWebSocket(
  httpServer: HttpServer,
  eventBus: EventBus,
  browserSessionGateway?: BrowserSessionGateway,
  apiSecurity?: ApiSecurityService
): void {
  const eventServer = new WebSocketServer({ noServer: true });
  const browserClientServer = new WebSocketServer({ noServer: true });
  setupEventConnections(eventServer, eventBus);

  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws') {
      const authentication = apiSecurity?.authenticate(request.headers);
      if (authentication && !authentication.ok) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (authentication?.ok && apiSecurity && !apiSecurity.hasPermission(authentication.principal, 'system:read')) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      eventServer.handleUpgrade(request, socket, head, (webSocket) => {
        eventServer.emit('connection', webSocket, request);
      });
      return;
    }
    if (browserSessionGateway && url.pathname === '/api/browser-clients/connect') {
      browserClientServer.handleUpgrade(request, socket, head, (webSocket) => {
        browserSessionGateway.acceptConnection(webSocket);
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
    'task:created', 'task:started', 'task:progress', 'task:metadata_extracted', 'task:waiting_for_browser_worker',
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
