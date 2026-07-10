import { describe, it, expect, beforeEach } from '@jest/globals';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { EventBus } from '../../../src/events/bus';
import type { IComicAdapter } from '../../../../shared/types';

class MockAdapter implements IComicAdapter {
  readonly id: string;
  readonly name: string;
  readonly domains: string[];
  readonly parseMode = 'static' as const;

  constructor(id: string, name: string, domains: string[]) {
    this.id = id;
    this.name = name;
    this.domains = domains;
  }

  matchUrl(url: string): boolean {
    return this.domains.some((d) => url.includes(d));
  }
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    registry = new AdapterRegistry(eventBus);
  });

  it('should register an adapter', () => {
    const adapter = new MockAdapter('test', 'Test', ['test.com']);
    registry.register(adapter);

    expect(registry.has('test')).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('should throw when registering duplicate adapter', () => {
    const adapter = new MockAdapter('test', 'Test', ['test.com']);
    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow();
  });

  it('should unregister an adapter', () => {
    const adapter = new MockAdapter('test', 'Test', ['test.com']);
    registry.register(adapter);
    registry.unregister('test');

    expect(registry.has('test')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('should get adapter by id', () => {
    const adapter = new MockAdapter('test', 'Test', ['test.com']);
    registry.register(adapter);

    expect(registry.get('test')).toBe(adapter);
    expect(registry.get('non-existent')).toBeUndefined();
  });

  it('should find adapter by URL', () => {
    const adapter = new MockAdapter('test', 'Test', ['test.com']);
    registry.register(adapter);

    expect(registry.findByUrl('https://test.com/comic/1')).toBe(adapter);
    expect(registry.findByUrl('https://other.com/comic/1')).toBeUndefined();
  });

  it('should list all adapters', () => {
    registry.register(new MockAdapter('a', 'A', ['a.com']));
    registry.register(new MockAdapter('b', 'B', ['b.com']));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((l) => l.id)).toContain('a');
    expect(list.map((l) => l.id)).toContain('b');
  });

  it('should emit event on register', () => {
    const handler = jest.fn();
    eventBus.on('adapter:registered', handler);

    registry.register(new MockAdapter('test', 'Test', ['test.com']));

    expect(handler).toHaveBeenCalledWith({ adapterId: 'test' });
  });

  it('should clear all adapters', () => {
    registry.register(new MockAdapter('a', 'A', ['a.com']));
    registry.register(new MockAdapter('b', 'B', ['b.com']));
    registry.clear();

    expect(registry.size).toBe(0);
  });
});
