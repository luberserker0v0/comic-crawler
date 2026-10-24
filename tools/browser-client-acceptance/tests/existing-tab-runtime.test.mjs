import assert from 'node:assert/strict';
import test from 'node:test';
import { ExistingTabAcceptanceRuntime } from '../consumer.mjs';

test('registers, updates, and revokes pages from the owned acceptance browser', testTabSynchronization);

async function testTabSynchronization() {
  const fixture = createFixture();
  await fixture.runtime.start(fixture.signal);
  fixture.control.online = true;
  fixture.page.currentUrl = 'https://example.test/chapter-1';
  await fixture.runtime.synchronizeTabs();
  assertRegistration(fixture, 'https://example.test/chapter-1');
  await assertBusyLeaseIsPreserved(fixture);
  fixture.control.busy = false;
  fixture.page.currentUrl = 'https://example.test/chapter-2';
  await fixture.runtime.synchronizeTabs();
  assertRegistration(fixture, 'https://example.test/chapter-2');
  fixture.pages.length = 0;
  await fixture.runtime.synchronizeTabs();
  assert.equal(fixture.revoked.length, 2);
  await fixture.runtime.close();
  assert.equal(fixture.lifecycle.released, true);
}

async function assertBusyLeaseIsPreserved(fixture) {
  fixture.control.busy = true;
  fixture.page.currentUrl = 'https://example.test/chapter-2';
  await fixture.runtime.synchronizeTabs();
  assert.equal(fixture.registered.length, 1);
  assert.equal(fixture.errors.length, 0);
}

function createFixture() {
  const page = fakePage();
  const pages = [page];
  const registered = [];
  const revoked = [];
  const errors = [];
  const lifecycle = { released: false };
  const control = { online: false, busy: false };
  const client = fakeClient(registered, revoked, control);
  const runtime = new ExistingTabAcceptanceRuntime(runtimeOptions(client, pages, lifecycle, errors));
  return { runtime, page, pages, registered, revoked, errors, lifecycle, control,
    signal: new AbortController().signal };
}

function runtimeOptions(client, pages, lifecycle, errors) {
  return {
    client,
    provisioner: { async prepare() { return preparedProfile(lifecycle); } },
    browserType: { async launchPersistentContext() { return fakeContext(pages); } },
    launchOptions: {},
    onError: (error) => errors.push(error),
  };
}

function preparedProfile(lifecycle) {
  return { userDataDir: 'acceptance-profile', async release() { lifecycle.released = true; } };
}

function fakeContext(pages) {
  return { pages: () => pages, async newPage() { throw new Error('unexpected new page'); }, async close() {} };
}

function fakePage() {
  return {
    currentUrl: 'about:blank',
    url() { return this.currentUrl; },
    async title() { return 'Chapter'; },
  };
}

function fakeClient(registered, revoked, control) {
  return {
    getConnection: () => control.online ? { workerId: 'worker-1' } : undefined,
    async registerResource(input) {
      registered.push(input);
      return { ...input, localHandle: undefined, resourceId: `resource-${registered.length}` };
    },
    async revokeResource(resourceId) {
      if (control.busy) throw new Error('Browser resource is in use.');
      revoked.push(resourceId);
    },
  };
}

function assertRegistration(fixture, url) {
  assert.equal(fixture.registered.at(-1).url, url);
  assert.equal(fixture.registered.at(-1).localHandle, fixture.page);
}
