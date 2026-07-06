import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventBus } from '../../../src/events/bus';
import type { EventMap } from '../../../src/events/types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should emit and receive events', () => {
    const handler = jest.fn<void, [EventMap['task:created']]>();
    bus.on('task:created', handler);

    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ taskId: '123', url: 'https://example.com' });
  });

  it('should support multiple listeners for the same event', () => {
    const handler1 = jest.fn<void, [EventMap['task:created']]>();
    const handler2 = jest.fn<void, [EventMap['task:created']]>();
    bus.on('task:created', handler1);
    bus.on('task:created', handler2);

    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe correctly', () => {
    const handler = jest.fn<void, [EventMap['task:created']]>();
    const subscription = bus.on('task:created', handler);

    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();

    bus.emit('task:created', { taskId: '456', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support once listeners', () => {
    const handler = jest.fn<void, [EventMap['task:created']]>();
    bus.once('task:created', handler);

    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);

    bus.emit('task:created', { taskId: '456', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should return listener count', () => {
    expect(bus.listenerCount('task:created')).toBe(0);

    const h1 = jest.fn();
    const h2 = jest.fn();
    bus.on('task:created', h1);
    bus.on('task:created', h2);

    expect(bus.listenerCount('task:created')).toBe(2);

    bus.off('task:created', h1);
    expect(bus.listenerCount('task:created')).toBe(1);
  });

  it('should remove all listeners', () => {
    bus.on('task:created', jest.fn());
    bus.on('task:created', jest.fn());
    bus.on('task:completed', jest.fn());

    bus.removeAllListeners('task:created');
    expect(bus.listenerCount('task:created')).toBe(0);
    expect(bus.listenerCount('task:completed')).toBe(1);

    bus.removeAllListeners();
    expect(bus.listenerCount('task:completed')).toBe(0);
  });

  it('should handle async handlers without crashing', async () => {
    const handler = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    bus.on('task:created', handler);

    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
