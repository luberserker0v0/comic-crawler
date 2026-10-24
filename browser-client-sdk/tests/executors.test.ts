import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DriverBrowserExecutor,
  ExistingTabAcquisitionStrategy,
  ManagedProfileAcquisitionStrategy,
  type BrowserPageDriver,
  type BrowserSession,
  type ManagedProfile,
} from '../src';

interface Page {
  url: string;
  html: string;
  focused: boolean;
}

const driver: BrowserPageDriver<Page> = {
  async currentUrl(page) { return page.url; },
  async navigate(page, url) { page.url = url; return url; },
  async content(page) { return page.html; },
  async waitForReady() {},
  async prepareContent() {},
  async focus(page) { page.focused = true; },
};

test('existing-tab acquisition adopts and preserves a registered tab', testExistingTabLifecycle);
test('existing-tab acquisition rejects a moved or concurrently leased tab', testExistingTabRejection);
test('the shared executor forwards cancellation to the BrowserPageDriver', testExistingTabCancellation);
test('managed-profile acquisition opens and closes its owned profile', testManagedProfileLifecycle);

async function testExistingTabLifecycle(): Promise<void> {
  const page = createPage('https://example.test/chapter');
  const executor = existingTabExecutor(driver);
  await executor.registerResource(resource(page.url), page);
  const session = await executor.openSession(existingRequest(page.url), signal());
  await assertExistingTabCommands(session, page);
  await session.close();
  assert.equal(page.url, 'https://example.test/chapter');
  await executor.revokeResource('resource-1');
}

async function assertExistingTabCommands(session: BrowserSession, page: Page): Promise<void> {
  assert.deepEqual(await session.execute({ type: 'page.get-content' }, signal()), {
    type: 'page.get-content', url: page.url, html: '<main/>',
  });
  assert.deepEqual(await session.execute({
    type: 'page.prepare-content', strategy: 'scroll-through',
  }, signal()), { type: 'page.prepare-content', url: page.url });
  await session.execute({ type: 'page.focus' }, signal());
  assert.equal(page.focused, true);
}

async function testExistingTabRejection(): Promise<void> {
  const page = createPage('https://example.test/chapter');
  const executor = existingTabExecutor(driver);
  await executor.registerResource(resource(page.url), page);
  const request = existingRequest(page.url);
  const first = await executor.openSession(request, signal());
  await assert.rejects(() => executor.openSession(otherLease(request), signal()), /busy/);
  await first.close();
  page.url = 'https://example.test/another-chapter';
  await assert.rejects(() => executor.openSession(request, signal()), /not on the requested URL/);
}

async function testExistingTabCancellation(): Promise<void> {
  const page = createPage('https://example.test/chapter');
  const abortDriver = { ...driver, async content(_page: Page, commandSignal: AbortSignal) {
    if (commandSignal.aborted) throw new Error('Browser Client command was cancelled.');
    return page.html;
  } };
  const executor = existingTabExecutor(abortDriver);
  await executor.registerResource(resource(page.url), page);
  const session = await executor.openSession(existingRequest(page.url), signal());
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => session.execute({ type: 'page.get-content' }, controller.signal), /cancelled/);
}

async function testManagedProfileLifecycle(): Promise<void> {
  const page = createPage('about:blank');
  let profileClosed = false;
  const profile: ManagedProfile<Page> = { page, async close() { profileClosed = true; } };
  const strategy = new ManagedProfileAcquisitionStrategy({ async open() { return profile; } });
  const executor = new DriverBrowserExecutor(driver, strategy);
  const session = await executor.openSession(managedRequest(), signal());
  assert.equal(page.url, 'about:blank');
  await session.close();
  assert.equal(profileClosed, true);
}

function existingTabExecutor(pageDriver: BrowserPageDriver<Page>) {
  return new DriverBrowserExecutor(pageDriver, new ExistingTabAcquisitionStrategy(pageDriver));
}

function createPage(url: string): Page {
  return { url, html: '<main/>', focused: false };
}

function resource(url: string) {
  return { resourceId: 'resource-1', kind: 'tab' as const, url };
}

function existingRequest(expectedUrl: string) {
  return {
    sessionId: 'session-1', leaseId: 'lease-1',
    source: {
      type: 'existing-resource' as const, resourceId: 'resource-1', expectedUrl,
      navigationPolicy: 'adopt-current-page' as const,
    },
  };
}

function otherLease(request: ReturnType<typeof existingRequest>) {
  return { ...request, sessionId: 'session-2', leaseId: 'lease-2' };
}

function managedRequest() {
  return {
    sessionId: 'session-1', leaseId: 'lease-1',
    source: {
      type: 'managed-profile' as const, initialUrl: 'https://example.test/chapter',
      navigationPolicy: 'navigate-to-target' as const,
    },
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
