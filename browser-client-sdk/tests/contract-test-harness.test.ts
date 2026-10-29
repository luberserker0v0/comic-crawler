import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserExecutorContractError,
  DriverBrowserExecutor,
  ExistingTabAcquisitionStrategy,
  ManagedProfileAcquisitionStrategy,
  runBrowserExecutorContract,
  type BrowserExecutor,
  type BrowserPageDriver,
} from '../src';

interface Page {
  url: string;
  html: string;
  focused: boolean;
  closed: boolean;
}

const driver: BrowserPageDriver<Page> = {
  async currentUrl(page) { return page.url; },
  async navigate(page, url) { page.url = url; return url; },
  async content(page) { return page.html; },
  async waitForReady() {},
  async prepareContent() { return completedPreparation(); },
  async focus(page) { page.focused = true; },
};

function completedPreparation() {
  const progress = { status: 'progressing' as const, phase: 'candidates' as const,
    discoveredCandidates: 1, processedCandidates: 0, capturedImages: 0, fallbackSteps: 0 };
  return { progress, async step() { return { ...progress, status: 'completed' as const,
    phase: 'completed' as const, processedCandidates: 1, capturedImages: 1 }; }, async finish() {} };
}

test('portable contract harness validates an existing-tab executor', testExistingTabContract);
test('portable contract harness validates a managed-profile executor', testManagedProfileContract);
test('portable contract harness identifies the failed contract check', testFailedContractCheck);

async function testExistingTabContract(): Promise<void> {
  const page = createPage('https://example.test/chapter', '<main>chapter</main>');
  const result = await runBrowserExecutorContract(existingTabContract(page));
  assert.equal(result.capabilities.executionMode, 'existing-tab');
  assert.deepEqual(result.checks, expectedChecks());
}

function existingTabContract(page: Page) {
  return {
    createExecutor: () => existingTabExecutor(),
    request: existingRequest(page.url),
    resource: { descriptor: existingResource(page.url), localHandle: page },
    expectedInitialUrl: page.url,
    expectedInitialHtml: page.html,
    navigationUrl: 'https://example.test/chapter-2',
    afterFocus: () => assert.equal(page.focused, true),
    afterSessionClose: () => assert.equal(page.closed, false),
  };
}

function existingRequest(expectedUrl: string) {
  return {
    sessionId: 'session-existing',
    leaseId: 'lease-existing',
    source: {
      type: 'existing-resource' as const,
      resourceId: 'resource-existing',
      expectedUrl,
      navigationPolicy: 'adopt-current-page' as const,
    },
  };
}

function existingResource(url: string) {
  return { resourceId: 'resource-existing', kind: 'tab' as const, url };
}

async function testManagedProfileContract(): Promise<void> {
  const page = createPage('about:blank', '<main>managed</main>');
  const result = await runBrowserExecutorContract(managedProfileContract(page));
  assert.equal(result.capabilities.executionMode, 'managed-profile');
  assert.equal(result.checks.at(-1), 'executor-close');
}

function managedProfileContract(page: Page) {
  return {
    createExecutor: () => new DriverBrowserExecutor(driver,
      new ManagedProfileAcquisitionStrategy(managedLauncher(page))),
    request: managedRequest(),
    expectedInitialUrl: 'about:blank',
    expectedInitialHtml: page.html,
    navigationUrl: 'https://example.test/chapter',
    afterFocus: () => assert.equal(page.focused, true),
    afterSessionClose: () => assert.equal(page.closed, true),
  };
}

function existingTabExecutor() {
  return new DriverBrowserExecutor(driver, new ExistingTabAcquisitionStrategy(driver));
}

function managedLauncher(page: Page) {
  return { async open() { return { page, async close() { page.closed = true; } }; } };
}

function managedRequest() {
  return {
    sessionId: 'session-managed',
    leaseId: 'lease-managed',
    source: {
      type: 'managed-profile' as const,
      initialUrl: 'https://example.test/chapter',
      navigationPolicy: 'navigate-to-target' as const,
    },
  };
}

async function testFailedContractCheck(): Promise<void> {
  await assert.rejects(
    () => runBrowserExecutorContract(invalidContract()),
    (error: unknown) => error instanceof BrowserExecutorContractError && error.check === 'capabilities'
  );
}

function invalidContract() {
  return {
    createExecutor: (): BrowserExecutor => invalidExecutor(),
    request: invalidRequest(),
    expectedInitialUrl: 'https://example.test/chapter',
    expectedInitialHtml: '<main/>',
    navigationUrl: 'https://example.test/chapter-2',
  };
}

function invalidExecutor(): BrowserExecutor {
  return {
    async describe() {
      return { executionMode: 'existing-tab', navigation: false, renderedDom: true, humanHandoff: true, responsiveViewport: false };
    },
    async openSession() { throw new Error('must not open'); },
    async close() {},
  };
}

function invalidRequest() {
  return {
    sessionId: 'session-invalid',
    leaseId: 'lease-invalid',
    source: {
      type: 'existing-resource' as const,
      resourceId: 'resource-invalid',
      expectedUrl: 'https://example.test/chapter',
      navigationPolicy: 'adopt-current-page' as const,
    },
  };
}

function createPage(url: string, html: string): Page {
  return { url, html, focused: false, closed: false };
}

function expectedChecks() {
  return [
    'capabilities', 'resource-registration', 'session-open', 'current-url',
    'rendered-dom', 'ready-state', 'content-preparation', 'focus', 'navigation',
    'session-close', 'closed-session-rejection', 'resource-revocation', 'executor-close',
  ];
}
