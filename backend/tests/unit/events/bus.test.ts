import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventBus } from '../../../src/events/bus';
import type { EventMap } from '../../../src/events/types';

let bus: EventBus;

describe('EventBus', () => {
  EventBusTestGroup1();
});

function EventBusTestGroup1(): void {
  beforeEach(EventBusTestScenario1);
  it('should emit and receive events', EventBusTestShouldEmitAndReceiveEvents);
  it('should support multiple listeners for the same event', EventBusTestShouldSupportMultipleListenersForTheSameEvent);
  it('should unsubscribe correctly', EventBusTestShouldUnsubscribeCorrectly);
  it('should support once listeners', EventBusTestShouldSupportOnceListeners);
  it('should return listener count', EventBusTestShouldReturnListenerCount);
  it('should remove all listeners', EventBusTestShouldRemoveAllListeners);
  it('should handle async handlers without crashing', EventBusTestShouldHandleAsyncHandlersWithoutCrashing);
}

function EventBusTestScenario1() {
    bus = new EventBus();
}

function EventBusTestShouldEmitAndReceiveEvents() {
    const handler = jest.fn<void, [
        EventMap['task:created']
    ]>();
    bus.on('task:created', handler);
    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ taskId: '123', url: 'https://example.com' });
}

function EventBusTestShouldSupportMultipleListenersForTheSameEvent() {
    const handler1 = jest.fn<void, [
        EventMap['task:created']
    ]>();
    const handler2 = jest.fn<void, [
        EventMap['task:created']
    ]>();
    bus.on('task:created', handler1);
    bus.on('task:created', handler2);
    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
}

function EventBusTestShouldUnsubscribeCorrectly() {
    const handler = jest.fn<void, [
        EventMap['task:created']
    ]>();
    const subscription = bus.on('task:created', handler);
    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    bus.emit('task:created', { taskId: '456', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
}

function EventBusTestShouldSupportOnceListeners() {
    const handler = jest.fn<void, [
        EventMap['task:created']
    ]>();
    bus.once('task:created', handler);
    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
    bus.emit('task:created', { taskId: '456', url: 'https://example.com' });
    expect(handler).toHaveBeenCalledTimes(1);
}

function EventBusTestShouldReturnListenerCount() {
    expect(bus.listenerCount('task:created')).toBe(0);
    const h1 = jest.fn();
    const h2 = jest.fn();
    bus.on('task:created', h1);
    bus.on('task:created', h2);
    expect(bus.listenerCount('task:created')).toBe(2);
    bus.off('task:created', h1);
    expect(bus.listenerCount('task:created')).toBe(1);
}

function EventBusTestShouldRemoveAllListeners() {
    bus.on('task:created', jest.fn());
    bus.on('task:created', jest.fn());
    bus.on('task:completed', jest.fn());
    bus.removeAllListeners('task:created');
    expect(bus.listenerCount('task:created')).toBe(0);
    expect(bus.listenerCount('task:completed')).toBe(1);
    bus.removeAllListeners();
    expect(bus.listenerCount('task:completed')).toBe(0);
}

async function EventBusTestShouldHandleAsyncHandlersWithoutCrashing() {
    const handler = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
    bus.on('task:created', handler);
    bus.emit('task:created', { taskId: '123', url: 'https://example.com' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(1);
}
