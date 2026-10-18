import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExistingTabExecutor,
  ManagedProfileExecutor,
  type BrowserPageDriver,
  type ManagedProfile,
} from '../src';

interface Page {
  url: string;
  html: string;
  focused: boolean;
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

test('ExistingTabExecutor adopts and preserves a registered tab', async () => {
  const page: Page = { url: 'https://example.test/chapter', html: '<main/>', focused: false };
  const executor = new ExistingTabExecutor(driver);
  await executor.registerResource({
    resourceId: 'resource-1',
    kind: 'tab',
    url: page.url,
  }, page);
  const session = await executor.openSession({
    sessionId: 'session-1',
    leaseId: 'lease-1',
    source: {
      type: 'existing-resource',
      resourceId: 'resource-1',
      expectedUrl: page.url,
      navigationPolicy: 'adopt-current-page',
    },
  }, new AbortController().signal);

  assert.deepEqual(await session.execute({ type: 'page.get-content' }, new AbortController().signal), {
    type: 'page.get-content',
    url: page.url,
    html: '<main/>',
  });
  assert.deepEqual(await session.execute({
    type: 'page.prepare-content',
    strategy: 'scroll-through',
  }, new AbortController().signal), {
    type: 'page.prepare-content',
    url: page.url,
  });
  await session.execute({ type: 'page.focus' }, new AbortController().signal);
  assert.equal(page.focused, true);
  await session.close();
  assert.equal(page.url, 'https://example.test/chapter');
  await executor.revokeResource('resource-1');
});

test('ExistingTabExecutor rejects a moved or concurrently leased tab', async () => {
  const page: Page = { url: 'https://example.test/chapter', html: '<main/>', focused: false };
  const executor = new ExistingTabExecutor(driver);
  await executor.registerResource({ resourceId: 'resource-1', kind: 'tab', url: page.url }, page);
  const request = {
    sessionId: 'session-1',
    leaseId: 'lease-1',
    source: {
      type: 'existing-resource' as const,
      resourceId: 'resource-1',
      expectedUrl: page.url,
      navigationPolicy: 'adopt-current-page' as const,
    },
  };
  const first = await executor.openSession(request, new AbortController().signal);
  await assert.rejects(
    () => executor.openSession({ ...request, sessionId: 'session-2', leaseId: 'lease-2' }, new AbortController().signal),
    /busy/
  );
  await first.close();
  page.url = 'https://example.test/another-chapter';
  await assert.rejects(
    () => executor.openSession(request, new AbortController().signal),
    /not on the requested URL/
  );
});

test('ManagedProfileExecutor opens a profile without navigation and closes its owned profile', async () => {
  const page: Page = { url: 'about:blank', html: '<main/>', focused: false };
  let profileClosed = false;
  const profile: ManagedProfile<Page> = {
    page,
    async close() {
      profileClosed = true;
    },
  };
  const executor = new ManagedProfileExecutor(driver, { async open() { return profile; } });
  const session = await executor.openSession({
    sessionId: 'session-1',
    leaseId: 'lease-1',
    source: {
      type: 'managed-profile',
      initialUrl: 'https://example.test/chapter',
      navigationPolicy: 'navigate-to-target',
    },
  }, new AbortController().signal);

  assert.equal(page.url, 'about:blank');
  await session.close();
  assert.equal(profileClosed, true);
});
