import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
  type BrowserCommand,
  type BrowserServerToClientMessage,
} from './contracts';
import { BrowserClientError } from './errors';

export function parseServerMessage(value: unknown): BrowserServerToClientMessage {
  if (!isRecord(value)) throw protocolError('Message must be an object.');
  requireProtocolVersion(value);
  if (typeof value.type !== 'string') throw protocolError('Message type is required.');
  const validator = serverMessageValidators[value.type];
  if (!validator) throw protocolError(`Unknown browser client message type "${value.type}".`);
  validator(value);
  return value as unknown as BrowserServerToClientMessage;
}

const serverMessageValidators: Record<string, (value: Record<string, unknown>) => void> = {
  'client.authenticated': validateAuthenticated,
  'client.rejected': (value) => requireString(value, 'reason'),
  'resource.registered': validateResourceRegistered,
  'resource.revoked': validateResourceRevoked,
  'resource.rejected': validateResourceRejected,
  'session.open': validateSessionOpen,
  'session.close': validateSessionClose,
  'command.execute': validateCommandExecute,
};

function requireProtocolVersion(value: Record<string, unknown>): void {
  if (value.protocolVersion === BROWSER_CLIENT_PROTOCOL_VERSION) return;
  throw protocolError(`Unsupported browser client protocol version "${String(value.protocolVersion)}".`);
}

function validateAuthenticated(value: Record<string, unknown>): void {
  requireString(value, 'workerId');
  requirePositiveNumber(value, 'heartbeatIntervalMs');
}

function validateResourceRegistered(value: Record<string, unknown>): void {
  requireString(value, 'requestId');
  parseResource(value.resource);
}

function validateResourceRevoked(value: Record<string, unknown>): void {
  requireString(value, 'requestId');
  requireString(value, 'resourceId');
}

function validateResourceRejected(value: Record<string, unknown>): void {
  requireString(value, 'requestId');
  parseCommandError(value.error);
}

function validateSessionOpen(value: Record<string, unknown>): void {
  if (!isRecord(value.request)) throw protocolError('Session request is required.');
  requireString(value.request, 'sessionId');
  requireString(value.request, 'leaseId');
  parseSessionSource(value.request.source);
}

function validateSessionClose(value: Record<string, unknown>): void {
  requireString(value, 'sessionId');
  requireString(value, 'leaseId');
}

function validateCommandExecute(value: Record<string, unknown>): void {
  requireString(value, 'requestId');
  requireString(value, 'sessionId');
  requireString(value, 'leaseId');
  parseCommand(value.command);
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
  const validator = commandValidators[value.type];
  if (!validator) throw unsupportedCommand(value.type);
  validator(value);
  return value as BrowserCommand;
}

const commandValidators: Record<string, (value: Record<string, unknown>) => void> = {
  'page.navigate': (value) => requireString(value, 'url'),
  'page.get-url': () => undefined,
  'page.get-content': () => undefined,
  'page.focus': () => undefined,
  'page.wait-for-ready': validateOptionalTimeout,
  'page.prepare-content': validateContentPreparation,
};

function validateOptionalTimeout(value: Record<string, unknown>): void {
  if (value.timeoutMs !== undefined) requirePositiveNumber(value, 'timeoutMs');
}

function validateContentPreparation(value: Record<string, unknown>): void {
  if (value.strategy !== 'scroll-through') {
    throw protocolError('Content preparation strategy must be "scroll-through".');
  }
  validateOptionalTimeout(value);
}

function unsupportedCommand(type: string): BrowserClientError {
  return new BrowserClientError(`Unsupported browser command "${type}".`, 'UNSUPPORTED_COMMAND');
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
