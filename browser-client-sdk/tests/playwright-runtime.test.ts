import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CopyProfileProvisioner,
  FreshProfileProvisioner,
  PlaywrightManagedProfileLauncher,
  PlaywrightPageDriver,
  type PlaywrightPageLike,
  type ProfileDirectoryAccess,
} from '../src';

class FakePage implements PlaywrightPageLike {
  current = 'about:blank';
  focused = false;

  url(): string { return this.current; }
  async goto(url: string): Promise<void> { this.current = url; }
  async content(): Promise<string> { return '<main>chapter</main>'; }
  async waitForLoadState(): Promise<void> {}
  async evaluate<R, A>(pageFunction: (argument: A) => R | Promise<R>, _argument: A): Promise<R> {
    if (pageFunction.name === 'initializeScrollPreparation') return 0 as R;
    if (pageFunction.name === 'scrollPreparationBottomStep') return true as R;
    return undefined as R;
  }
  async bringToFront(): Promise<void> { this.focused = true; }
}

test('Playwright launcher uses a fresh persistent context and deletes it on close', testFreshLauncher);

async function testFreshLauncher(): Promise<void> {
  const fixture = createLauncherFixture();
  const profile = await fixture.launcher.open({
    renderContext: { viewport: { width: 390, height: 844 }, isMobile: true },
    signal: new AbortController().signal,
  });
  assert.equal(profile.page, fixture.page);
  assertLaunch(fixture.state.launch);
  await profile.close();
  assert.equal(fixture.state.contextClosed, true);
  assert.deepEqual(fixture.state.removed, ['C:/tmp/comiccrawler-profile-123']);
}

function assertLaunch(launch: LauncherState['launch']): void {
  assert.equal(launch?.userDataDir, 'C:/tmp/comiccrawler-profile-123');
  assert.deepEqual(launch?.options, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: undefined,
    isMobile: true,
    hasTouch: undefined,
    userAgent: undefined,
  });
}

interface LauncherState {
  removed: string[];
  contextClosed: boolean;
  launch?: { userDataDir: string; options: Record<string, unknown> };
}

function createLauncherFixture() {
  const state: LauncherState = { removed: [], contextClosed: false };
  const page = new FakePage();
  const directories: ProfileDirectoryAccess = {
    async createTemporaryDirectory(prefix) { return `C:/tmp/${prefix}123`; },
    async removeDirectory(path) { state.removed.push(path); },
  };
  const launcher = new PlaywrightManagedProfileLauncher(
    fakeChromium(page, state),
    new FreshProfileProvisioner(directories)
  );
  return { state, page, launcher };
}

function fakeChromium(page: FakePage, state: LauncherState) {
  return { async launchPersistentContext(userDataDir: string, options: Record<string, unknown>) {
    state.launch = { userDataDir, options };
    return {
      pages: () => [page],
      async newPage() { return page; },
      async close() { state.contextClosed = true; },
    };
  } };
}

test('PlaywrightPageDriver maps semantic page commands', async () => {
  const page = new FakePage();
  const driver = new PlaywrightPageDriver<FakePage>();
  const signal = new AbortController().signal;

  assert.equal(await driver.navigate(page, 'https://example.test/chapter', signal), 'https://example.test/chapter');
  assert.equal(await driver.content(page, signal), '<main>chapter</main>');
  await driver.prepareContent(page, 'scroll-through', 1_000, signal);
  await driver.focus(page, signal);
  assert.equal(page.focused, true);
});

test('CopyProfileProvisioner applies the fixed cache and lock exclusions', async () => {
  let copied: Parameters<NonNullable<ProfileDirectoryAccess['copyChromeProfile']>>[0] | undefined;
  const directories: ProfileDirectoryAccess = {
    async createTemporaryDirectory() { return 'C:/tmp/copied'; },
    async removeDirectory() {},
    async copyChromeProfile(input) { copied = input; },
  };
  const provisioner = new CopyProfileProvisioner(directories, 'C:/Chrome/User Data', 'Profile 1');
  const profile = await provisioner.prepare(new AbortController().signal);

  assert.equal(copied?.sourceProfile, 'Profile 1');
  assert.ok(copied?.excludedNames.includes('Cache'));
  assert.ok(copied?.excludedNames.includes('SingletonLock'));
  await profile.release();
});

test('CopyProfileProvisioner removes the temporary directory after copy failure', async () => {
  const removed: string[] = [];
  const directories: ProfileDirectoryAccess = {
    async createTemporaryDirectory() { return 'C:/tmp/failed-copy'; },
    async removeDirectory(path) { removed.push(path); },
    async copyChromeProfile() { throw new Error('Profile is locked'); },
  };
  const provisioner = new CopyProfileProvisioner(directories, 'C:/Chrome/User Data', 'Default');

  await assert.rejects(() => provisioner.prepare(new AbortController().signal), /Profile is locked/);
  assert.deepEqual(removed, ['C:/tmp/failed-copy']);
});
