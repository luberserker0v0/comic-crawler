import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
  type BrowserCommand,
  type BrowserServerToClientMessage,
} from './contracts';
import { BrowserClientError } from './errors';

export function parseServerMessage(value: unknown): BrowserServerToClientMessage {
  if (!isRecord(value)) throw protocolError('Message must be an object.');
  if (value.protocolVersion !== BROWSER_CLIENT_PROTOCOL_VERSION) {
    throw protocolError(`Unsupported browser client protocol version "${String(value.protocolVersion)}".`);
  }
  if (typeof value.type !== 'string') throw protocolError('Message type is required.');

  switch (value.type) {
    case 'client.authenticated':
      requireString(value, 'workerId');
      requirePositiveNumber(value, 'heartbeatIntervalMs');
      break;
    case 'client.rejected':
      requireString(value, 'reason');
      break;
    case 'resource.registered':
      requireString(value, 'requestId');
      parseResource(value.resource);
      break;
    case 'resource.revoked':
      requireString(value, 'requestId');
      requireString(value, 'resourceId');
      break;
    case 'resource.rejected':
      requireString(value, 'requestId');
      parseCommandError(value.error);
      break;
    case 'session.open':
      if (!isRecord(value.request)) throw protocolError('Session request is required.');
      requireString(value.request, 'sessionId');
      requireString(value.request, 'leaseId');
      parseSessionSource(value.request.source);
      break;
    case 'session.close':
      requireString(value, 'sessionId');
      requireString(value, 'leaseId');
      break;
    case 'command.execute':
      requireString(value, 'requestId');
      requireString(value, 'sessionId');
      requireString(value, 'leaseId');
      parseCommand(value.command);
      break;
    default:
      throw protocolError(`Unknown browser client message type "${value.type}".`);
  }
  return value as unknown as BrowserServerToClientMessage;
}

function parseCommandError(value: unknown): void {
  if (!isRecord(value)) throw protocolError('Browser resource error is required.');
  requireString(value, 'code');
  requireString(value, 'message');
  if (typeof value.retryable !== 'boolean') throw protocolError('Browser resource error retryable must be boolean.');
}

function parseResource(value: unknown): void {
  if (!isRecord(value)) throw protocolError('Browser resource is required.');
  requireString(value, 'resourceId');
  if (value.kind !== 'tab') throw protocolError('Browser resource kind must be "tab".');
  requireString(value, 'url');
  if (value.title !== undefined && typeof value.title !== 'string') {
    throw protocolError('Browser resource title must be a string.');
  }
}

function parseSessionSource(value: unknown): void {
  if (!isRecord(value)) throw protocolError('Browser session source is required.');
  if (value.type === 'existing-resource') {
    requireString(value, 'resourceId');
    requireString(value, 'expectedUrl');
    if (value.navigationPolicy !== 'adopt-current-page') {
      throw protocolError('Existing-resource sessions must adopt the current page.');
    }
    return;
  }
  if (value.type === 'managed-profile') {
    if (value.initialUrl !== undefined) requireString(value, 'initialUrl');
    if (value.navigationPolicy !== 'navigate-to-target') {
      throw protocolError('Managed-profile sessions must navigate to the target.');
    }
    return;
  }
  throw protocolError('Browser session source type is invalid.');
}

export function parseCommand(value: unknown): BrowserCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw protocolError('Browser command type is required.');
  }
  switch (value.type) {
    case 'page.navigate':
      requireString(value, 'url');
      break;
    case 'page.get-url':
    case 'page.get-content':
    case 'page.focus':
      break;
    case 'page.wait-for-ready':
      if (value.timeoutMs !== undefined) requirePositiveNumber(value, 'timeoutMs');
      break;
    case 'page.prepare-content':
      if (value.strategy !== 'scroll-through') {
        throw protocolError('Content preparation strategy must be "scroll-through".');
      }
      if (value.timeoutMs !== undefined) requirePositiveNumber(value, 'timeoutMs');
      break;
    default:
      throw new BrowserClientError(
        `Unsupported browser command "${value.type}".`,
        'UNSUPPORTED_COMMAND'
      );
  }
  return value as BrowserCommand;
}

export async function decodeSocketMessage(data: unknown): Promise<unknown> {
  let text: string;
  if (typeof data === 'string') {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else if (ArrayBuffer.isView(data)) {
    text = new TextDecoder().decode(data);
  } else {
    throw protocolError('WebSocket message must be text or an ArrayBuffer.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw protocolError('WebSocket message is not valid JSON.');
  }
}

function requireString(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== 'string' || record[key].length === 0) {
    throw protocolError(`Field "${key}" must be a non-empty string.`);
  }
}

function requirePositiveNumber(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw protocolError(`Field "${key}" must be a positive number.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(message: string): BrowserClientError {
  return new BrowserClientError(message, 'INVALID_STATE');
}
