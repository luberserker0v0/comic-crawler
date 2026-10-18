import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserExecutorContractError,
  ExistingTabExecutor,
  ManagedProfileExecutor,
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
  async currentUrl(page) {
    return page.url;
  },
  async navigate(page, url) {
    page.url = url;
    return url;
  },
  async content(page) {
    return page.html;
  },
  async waitForReady() {},
  async prepareContent() {},
  async focus(page) {
    page.focused = true;
  },
};

test('portable contract harness validates an existing-tab executor', async () => {
  const page: Page = {
    url: 'https://example.test/chapter',
    html: '<main>chapter</main>',
    focused: false,
    closed: false,
  };
  const result = await runBrowserExecutorContract({
    createExecutor: () => new ExistingTabExecutor(driver),
    request: {
      sessionId: 'session-existing',
      leaseId: 'lease-existing',
      source: {
        type: 'existing-resource',
        resourceId: 'resource-existing',
        expectedUrl: page.url,
        navigationPolicy: 'adopt-current-page',
      },
    },
    resource: {
      descriptor: {
        resourceId: 'resource-existing',
        kind: 'tab',
        url: page.url,
      },
      localHandle: page,
    },
    expectedInitialUrl: page.url,
    expectedInitialHtml: page.html,
    navigationUrl: 'https://example.test/chapter-2',
    afterFocus: () => assert.equal(page.focused, true),
    afterSessionClose: () => assert.equal(page.closed, false),
  });

  assert.equal(result.capabilities.executionMode, 'existing-tab');
  assert.deepEqual(result.checks, [
    'capabilities',
    'resource-registration',
    'session-open',
    'current-url',
    'rendered-dom',
    'ready-state',
    'content-preparation',
    'focus',
    'navigation',
    'session-close',
    'closed-session-rejection',
    'resource-revocation',
    'executor-close',
  ]);
});

test('portable contract harness validates a managed-profile executor', async () => {
  const page: Page = {
    url: 'about:blank',
    html: '<main>managed</main>',
    focused: false,
    closed: false,
  };
  const result = await runBrowserExecutorContract({
    createExecutor: () => new ManagedProfileExecutor(driver, {
      async open() {
        return {
          page,
          async close() {
            page.closed = true;
          },
        };
      },
    }),
    request: {
      sessionId: 'session-managed',
      leaseId: 'lease-managed',
      source: {
        type: 'managed-profile',
        initialUrl: 'https://example.test/chapter',
        navigationPolicy: 'navigate-to-target',
      },
    },
    expectedInitialUrl: 'about:blank',
    expectedInitialHtml: page.html,
    navigationUrl: 'https://example.test/chapter',
    afterFocus: () => assert.equal(page.focused, true),
    afterSessionClose: () => assert.equal(page.closed, true),
  });

  assert.equal(result.capabilities.executionMode, 'managed-profile');
  assert.equal(result.checks.at(-1), 'executor-close');
});

test('portable contract harness identifies the failed contract check', async () => {
  const executor: BrowserExecutor = {
    async describe() {
      return {
        executionMode: 'existing-tab',
        navigation: false,
        renderedDom: true,
        humanHandoff: true,
        responsiveViewport: false,
      };
    },
    async openSession() {
      throw new Error('must not open');
    },
    async close() {},
  };

  await assert.rejects(
    () => runBrowserExecutorContract({
      createExecutor: () => executor,
      request: {
        sessionId: 'session-invalid',
        leaseId: 'lease-invalid',
        source: {
          type: 'existing-resource',
          resourceId: 'resource-invalid',
          expectedUrl: 'https://example.test/chapter',
          navigationPolicy: 'adopt-current-page',
        },
      },
      expectedInitialUrl: 'https://example.test/chapter',
      expectedInitialHtml: '<main/>',
      navigationUrl: 'https://example.test/chapter-2',
    }),
    (error: unknown) => error instanceof BrowserExecutorContractError && error.check === 'capabilities'
  );
});
