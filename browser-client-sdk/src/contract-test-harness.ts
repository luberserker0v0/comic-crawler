import type {
  BrowserCapabilities,
  BrowserCommandResult,
  BrowserExecutor,
  BrowserResourceDescriptor,
  OpenBrowserSessionRequest,
} from './contracts';

export interface BrowserExecutorContractCase {
  createExecutor(): BrowserExecutor | Promise<BrowserExecutor>;
  request: OpenBrowserSessionRequest;
  expectedInitialUrl: string;
  expectedInitialHtml: string;
  navigationUrl: string;
  expectedNavigationUrl?: string;
  resource?: {
    descriptor: BrowserResourceDescriptor;
    localHandle: unknown;
  };
  afterFocus?(): void | Promise<void>;
  afterSessionClose?(): void | Promise<void>;
}

export interface BrowserExecutorContractResult {
  capabilities: BrowserCapabilities;
  checks: readonly BrowserExecutorContractCheck[];
}

export type BrowserExecutorContractCheck =
  | 'capabilities'
  | 'resource-registration'
  | 'session-open'
  | 'current-url'
  | 'rendered-dom'
  | 'ready-state'
  | 'content-preparation'
  | 'focus'
  | 'navigation'
  | 'session-close'
  | 'closed-session-rejection'
  | 'resource-revocation'
  | 'executor-close';

export class BrowserExecutorContractError extends Error {
  constructor(
    readonly check: BrowserExecutorContractCheck,
    message: string
  ) {
    super(`BrowserExecutor contract check "${check}" failed: ${message}`);
    this.name = 'BrowserExecutorContractError';
  }
}

/**
 * Runs the portable BrowserExecutor contract without depending on a test runner.
 * The harness owns the returned executor and always closes it before returning.
 */
export async function runBrowserExecutorContract(
  contract: BrowserExecutorContractCase
): Promise<BrowserExecutorContractResult> {
  const context = await createHarnessContext(contract);
  try {
    const capabilities = await verifyCapabilities(context);
    await prepareHarness(context);
    await verifyCurrentUrl(context);
    await verifyRenderedDom(context);
    await verifyReadyState(context);
    await verifyContentPreparation(context);
    await verifyFocus(context);
    await verifyNavigation(context);
    await closeAndRejectSession(context);
    await revokeResource(context);
    return { capabilities, checks: context.checks };
  } finally {
    await closeHarness(context);
  }
}

async function prepareHarness(context: HarnessContext): Promise<void> {
  await registerResource(context);
  await openSession(context);
}

interface HarnessContext {
  contract: BrowserExecutorContractCase;
  executor: BrowserExecutor;
  checks: BrowserExecutorContractCheck[];
  session?: Awaited<ReturnType<BrowserExecutor['openSession']>>;
}

async function createHarnessContext(contract: BrowserExecutorContractCase): Promise<HarnessContext> {
  return { contract, executor: await contract.createExecutor(), checks: [] };
}

async function verifyCapabilities(context: HarnessContext): Promise<BrowserCapabilities> {
  const capabilities = await checked('capabilities', () => context.executor.describe());
  assertModeMatchesSource(capabilities, context.contract.request);
  context.checks.push('capabilities');
  return capabilities;
}

async function registerResource(context: HarnessContext): Promise<void> {
  const resource = context.contract.resource;
  if (!resource) return;
  const register = context.executor.registerResource;
  if (!register) throw missingResourceOperation('resource-registration');
  await checked('resource-registration', () => register.call(
    context.executor,
    resource.descriptor,
    resource.localHandle
  ));
  context.checks.push('resource-registration');
}

async function openSession(context: HarnessContext): Promise<void> {
  context.session = await checked('session-open', () => context.executor.openSession(
    context.contract.request,
    new AbortController().signal
  ));
  context.checks.push('session-open');
}

async function verifyCurrentUrl(context: HarnessContext): Promise<void> {
  const result = await execute(context, 'current-url', { type: 'page.get-url' });
  assertResultType('current-url', result, 'page.get-url');
  assertUrl('current-url', result.url, context.contract.expectedInitialUrl);
  context.checks.push('current-url');
}

async function verifyRenderedDom(context: HarnessContext): Promise<void> {
  const result = await execute(context, 'rendered-dom', { type: 'page.get-content' });
  assertResultType('rendered-dom', result, 'page.get-content');
  assertUrl('rendered-dom', result.url, context.contract.expectedInitialUrl);
  if (result.html !== context.contract.expectedInitialHtml) {
    throw new BrowserExecutorContractError('rendered-dom', 'returned HTML does not match the expected rendered DOM');
  }
  context.checks.push('rendered-dom');
}

async function verifyReadyState(context: HarnessContext): Promise<void> {
  const command = { type: 'page.wait-for-ready' as const, timeoutMs: 1_000 };
  const result = await execute(context, 'ready-state', command);
  assertResultType('ready-state', result, 'page.wait-for-ready');
  context.checks.push('ready-state');
}

async function verifyContentPreparation(context: HarnessContext): Promise<void> {
  const command = { type: 'page.prepare-content' as const, strategy: 'scroll-through' as const, timeoutMs: 1_000 };
  const result = await execute(context, 'content-preparation', command);
  assertResultType('content-preparation', result, 'page.prepare-content');
  context.checks.push('content-preparation');
}

async function verifyFocus(context: HarnessContext): Promise<void> {
  const result = await execute(context, 'focus', { type: 'page.focus' });
  assertResultType('focus', result, 'page.focus');
  await checked('focus', async () => context.contract.afterFocus?.());
  context.checks.push('focus');
}

async function verifyNavigation(context: HarnessContext): Promise<void> {
  const result = await execute(context, 'navigation', {
    type: 'page.navigate',
    url: context.contract.navigationUrl,
  });
  assertResultType('navigation', result, 'page.navigate');
  const expected = context.contract.expectedNavigationUrl ?? context.contract.navigationUrl;
  assertUrl('navigation', result.url, expected);
  context.checks.push('navigation');
}

async function closeAndRejectSession(context: HarnessContext): Promise<void> {
  const session = requireHarnessSession(context);
  await checked('session-close', () => session.close());
  await checked('session-close', async () => context.contract.afterSessionClose?.());
  context.checks.push('session-close');
  await expectRejected('closed-session-rejection', () => session.execute(
    { type: 'page.get-url' },
    new AbortController().signal
  ));
  context.checks.push('closed-session-rejection');
  context.session = undefined;
}

async function revokeResource(context: HarnessContext): Promise<void> {
  const resource = context.contract.resource;
  if (!resource) return;
  const revoke = context.executor.revokeResource;
  if (!revoke) throw missingResourceOperation('resource-revocation');
  await checked('resource-revocation', () => revoke.call(context.executor, resource.descriptor.resourceId));
  context.checks.push('resource-revocation');
}

async function closeHarness(context: HarnessContext): Promise<void> {
  await context.session?.close().catch(() => undefined);
  await checked('executor-close', () => context.executor.close());
  context.checks.push('executor-close');
}

async function execute(
  context: HarnessContext,
  check: BrowserExecutorContractCheck,
  command: Parameters<NonNullable<HarnessContext['session']>['execute']>[0]
): Promise<BrowserCommandResult> {
  const session = requireHarnessSession(context);
  return checked(check, () => session.execute(command, new AbortController().signal));
}

function requireHarnessSession(context: HarnessContext): NonNullable<HarnessContext['session']> {
  if (!context.session) throw new BrowserExecutorContractError('session-open', 'session is unavailable');
  return context.session;
}

function missingResourceOperation(check: 'resource-registration' | 'resource-revocation'): BrowserExecutorContractError {
  const operation = check === 'resource-registration' ? 'register' : 'revoke';
  return new BrowserExecutorContractError(check, `the contract provides a resource but the executor cannot ${operation} it`);
}

function assertModeMatchesSource(
  capabilities: BrowserCapabilities,
  request: OpenBrowserSessionRequest
): void {
  const expected = request.source.type === 'existing-resource' ? 'existing-tab' : 'managed-profile';
  if (capabilities.executionMode !== expected) {
    throw new BrowserExecutorContractError(
      'capabilities',
      `execution mode "${capabilities.executionMode}" does not match session source "${request.source.type}"`
    );
  }
  if (!capabilities.navigation || !capabilities.renderedDom || !capabilities.humanHandoff) {
    throw new BrowserExecutorContractError(
      'capabilities',
      'navigation, renderedDom, and humanHandoff must be enabled'
    );
  }
}

function assertResultType<T extends BrowserCommandResult['type']>(
  check: BrowserExecutorContractCheck,
  actual: BrowserCommandResult,
  expected: T
): asserts actual is Extract<BrowserCommandResult, { type: T }> {
  if (actual.type !== expected) {
    throw new BrowserExecutorContractError(check, `returned "${actual.type}" instead of "${expected}"`);
  }
}

function assertUrl(
  check: BrowserExecutorContractCheck,
  actual: string,
  expected: string
): void {
  if (new URL(actual).toString() !== new URL(expected).toString()) {
    throw new BrowserExecutorContractError(check, `returned URL "${actual}" instead of "${expected}"`);
  }
}

async function checked<T>(
  check: BrowserExecutorContractCheck,
  operation: () => T | Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BrowserExecutorContractError) throw error;
    throw new BrowserExecutorContractError(check, error instanceof Error ? error.message : String(error));
  }
}

async function expectRejected(
  check: BrowserExecutorContractCheck,
  operation: () => Promise<unknown>
): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }
  throw new BrowserExecutorContractError(check, 'operation unexpectedly succeeded');
}
