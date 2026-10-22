import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExistingTabExecutor,
  ManagedProfileExecutor,
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

test('ExistingTabExecutor adopts and preserves a registered tab', testExistingTabLifecycle);
test('ExistingTabExecutor rejects a moved or concurrently leased tab', testExistingTabRejection);
test('ManagedProfileExecutor opens a profile without navigation and closes its owned profile', testManagedProfileLifecycle);

async function testExistingTabLifecycle(): Promise<void> {
  const page = createPage('https://example.test/chapter');
  const executor = new ExistingTabExecutor(driver);
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
  const executor = new ExistingTabExecutor(driver);
  await executor.registerResource(resource(page.url), page);
  const request = existingRequest(page.url);
  const first = await executor.openSession(request, signal());
  await assert.rejects(() => executor.openSession(otherLease(request), signal()), /busy/);
  await first.close();
  page.url = 'https://example.test/another-chapter';
  await assert.rejects(() => executor.openSession(request, signal()), /not on the requested URL/);
}

async function testManagedProfileLifecycle(): Promise<void> {
  const page = createPage('about:blank');
  let profileClosed = false;
  const profile: ManagedProfile<Page> = { page, async close() { profileClosed = true; } };
  const executor = new ManagedProfileExecutor(driver, { async open() { return profile; } });
  const session = await executor.openSession(managedRequest(), signal());
  assert.equal(page.url, 'about:blank');
  await session.close();
  assert.equal(profileClosed, true);
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
