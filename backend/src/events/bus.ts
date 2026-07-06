import type { EventKey, EventHandler, Subscription, EventMap } from './types';
import { errorToLogObject } from '../error/types';
import { logger } from '../utils/logger';

export class EventBus {
  private listeners = new Map<EventKey, Set<EventHandler<EventKey>>>();

  on<K extends EventKey>(event: K, handler: EventHandler<K>): Subscription {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<EventKey>);

    return {
      unsubscribe: () => {
        this.off(event, handler);
      },
    };
  }

  off<K extends EventKey>(event: K, handler: EventHandler<K>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<EventKey>);
    }
  }

  once<K extends EventKey>(event: K, handler: EventHandler<K>): Subscription {
    const onceHandler: EventHandler<K> = async (payload) => {
      this.off(event, onceHandler);
      await handler(payload);
    };
    return this.on(event, onceHandler);
  }

  emit<K extends EventKey>(event: K, payload: EventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result.catch((error) => {
            logger.error({ event, error: errorToLogObject(error) }, 'EventBus error handling event');
          });
        }
      } catch (error) {
        logger.error({ event, error: errorToLogObject(error) }, 'EventBus error handling event');
      }
    }
  }

  removeAllListeners(event?: EventKey): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: EventKey): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
