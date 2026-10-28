import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_CLIENT_PROTOCOL_VERSION, decodeSocketMessage, parseServerMessage } from '../src';

test('parses a supported command envelope', () => {
  assert.deepEqual(parseServerMessage({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.execute',
    requestId: 'request-1',
    leaseId: 'lease-1',
    sessionId: 'session-1',
    command: { type: 'page.navigate', url: 'https://example.test/chapter' },
  }), {
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.execute',
    requestId: 'request-1',
    leaseId: 'lease-1',
    sessionId: 'session-1',
    command: { type: 'page.navigate', url: 'https://example.test/chapter' },
  });
});

test('parses a command cancellation envelope', () => {
  assert.doesNotThrow(() => parseServerMessage({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.cancel', requestId: 'request-1',
    leaseId: 'lease-1', sessionId: 'session-1',
  }));
});

test('rejects unknown protocol versions and commands', () => {
  assert.throws(() => parseServerMessage({
    protocolVersion: 99,
    type: 'session.close',
    sessionId: 'session-1',
    leaseId: 'lease-1',
  }), /Unsupported browser client protocol version/);

  assert.throws(() => parseServerMessage({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.execute',
    requestId: 'request-1',
    leaseId: 'lease-1',
    sessionId: 'session-1',
    command: { type: 'page.evaluate', script: 'document.cookie' },
  }), /Unsupported browser command/);
});

test('accepts only the bounded content preparation strategy', () => {
  const envelope = {
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
    type: 'command.execute',
    requestId: 'request-prepare',
    leaseId: 'lease-1',
    sessionId: 'session-1',
  };
  assert.doesNotThrow(() => parseServerMessage({
    ...envelope,
    command: { type: 'page.prepare-content', strategy: 'scroll-through', timeoutMs: 1_000,
      reader: { containerSelector: '.reader', pageSelector: '.page' } },
  }));
  assert.throws(() => parseServerMessage({
    ...envelope,
    command: { type: 'page.prepare-content', strategy: 'evaluate-script' },
  }), /strategy must be "scroll-through"/);
});

test('validates reader preparation selectors', () => {
  assert.throws(() => parseServerMessage({
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION, type: 'command.execute',
    requestId: 'request-prepare', leaseId: 'lease-1', sessionId: 'session-1',
    command: { type: 'page.prepare-content', strategy: 'scroll-through', reader: { pageSelector: 42 } },
  }), /Field "pageSelector" must be a non-empty string/);
});

test('decodes ArrayBuffer messages', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ value: 1 }));
  assert.deepEqual(await decodeSocketMessage(bytes.buffer), { value: 1 });
});
