import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { EventBus } from '../events/bus';
import type { EventKey } from '../events/types';

export function setupWebSocket(httpServer: HttpServer, eventBus: EventBus): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  const clients = new Set<WebSocket>();
  const subscriptions = new Map<WebSocket, Set<EventKey>>();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    subscriptions.set(ws, new Set());

    ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data);

        if (message.type === 'subscribe') {
          const subs = subscriptions.get(ws);
          if (subs) {
            subs.add(message.event);
          }
        } else if (message.type === 'unsubscribe') {
          const subs = subscriptions.get(ws);
          if (subs) {
            subs.delete(message.event);
          }
        }
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
    'task:created',
    'task:started',
    'task:progress',
    'task:paused',
    'task:resumed',
    'task:waiting_verification',
    'task:completed',
    'task:failed',
    'task:cancelled',
    'image:downloaded',
    'image:failed',
    'chapter:completed',
    'adapter:registered',
    'config:changed',
    'scheduler:triggered',
    'adapter:repair:triggered',
    'adapter:repair:started',
    'adapter:repair:attempted',
    'adapter:repair:validated',
    'adapter:repair:candidate-created',
    'adapter:repair:promotion-requested',
    'adapter:repair:promoted',
    'adapter:repair:failed',
    'adapter:repair:rolled-back',
  ];

  for (const event of events) {
    eventBus.on(event, (payload) => {
      const message = JSON.stringify({ event, data: payload });

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          const subs = subscriptions.get(client);
          if (!subs || subs.size === 0 || subs.has(event)) {
            client.send(message);
          }
        }
      }
    });
  }
}
