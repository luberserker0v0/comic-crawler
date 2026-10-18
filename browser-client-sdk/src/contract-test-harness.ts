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
  const executor = await contract.createExecutor();
  const checks: BrowserExecutorContractCheck[] = [];
  let session: Awaited<ReturnType<BrowserExecutor['openSession']>> | undefined;

  try {
    const capabilities = await checked('capabilities', () => executor.describe());
    assertModeMatchesSource(capabilities, contract.request);
    checks.push('capabilities');

    if (contract.resource) {
      if (!executor.registerResource) {
        throw new BrowserExecutorContractError(
          'resource-registration',
          'the contract provides a resource but the executor cannot register it'
        );
      }
      await checked('resource-registration', () => executor.registerResource!(
        contract.resource!.descriptor,
        contract.resource!.localHandle
      ));
      checks.push('resource-registration');
    }

    session = await checked('session-open', () => executor.openSession(
      contract.request,
      new AbortController().signal
    ));
    checks.push('session-open');

    const currentUrl = await checked('current-url', () => session!.execute(
      { type: 'page.get-url' },
      new AbortController().signal
    ));
    assertResultType('current-url', currentUrl, 'page.get-url');
    assertUrl('current-url', currentUrl.url, contract.expectedInitialUrl);
    checks.push('current-url');

    const content = await checked('rendered-dom', () => session!.execute(
      { type: 'page.get-content' },
      new AbortController().signal
    ));
    assertResultType('rendered-dom', content, 'page.get-content');
    assertUrl('rendered-dom', content.url, contract.expectedInitialUrl);
    if (content.html !== contract.expectedInitialHtml) {
      throw new BrowserExecutorContractError('rendered-dom', 'returned HTML does not match the expected rendered DOM');
    }
    checks.push('rendered-dom');

    const ready = await checked('ready-state', () => session!.execute(
      { type: 'page.wait-for-ready', timeoutMs: 1_000 },
      new AbortController().signal
    ));
    assertResultType('ready-state', ready, 'page.wait-for-ready');
    checks.push('ready-state');

    const prepared = await checked('content-preparation', () => session!.execute(
      { type: 'page.prepare-content', strategy: 'scroll-through', timeoutMs: 1_000 },
      new AbortController().signal
    ));
    assertResultType('content-preparation', prepared, 'page.prepare-content');
    checks.push('content-preparation');

    const focus = await checked('focus', () => session!.execute(
      { type: 'page.focus' },
      new AbortController().signal
    ));
    assertResultType('focus', focus, 'page.focus');
    await checked('focus', async () => contract.afterFocus?.());
    checks.push('focus');

    const navigation = await checked('navigation', () => session!.execute(
      { type: 'page.navigate', url: contract.navigationUrl },
      new AbortController().signal
    ));
    assertResultType('navigation', navigation, 'page.navigate');
    assertUrl('navigation', navigation.url, contract.expectedNavigationUrl ?? contract.navigationUrl);
    checks.push('navigation');

    await checked('session-close', () => session!.close());
    await checked('session-close', async () => contract.afterSessionClose?.());
    checks.push('session-close');

    await expectRejected('closed-session-rejection', () => session!.execute(
      { type: 'page.get-url' },
      new AbortController().signal
    ));
    checks.push('closed-session-rejection');
    session = undefined;

    if (contract.resource) {
      if (!executor.revokeResource) {
        throw new BrowserExecutorContractError(
          'resource-revocation',
          'the contract provides a resource but the executor cannot revoke it'
        );
      }
      await checked('resource-revocation', () => executor.revokeResource!(contract.resource!.descriptor.resourceId));
      checks.push('resource-revocation');
    }

    return { capabilities, checks };
  } finally {
    await session?.close().catch(() => undefined);
    await checked('executor-close', () => executor.close());
    checks.push('executor-close');
  }
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
