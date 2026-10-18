import assert from 'node:assert/strict';
import test from 'node:test';
import { WebExtensionTabDriver, type WebExtensionApi, type WebExtensionTab } from '../src';

test('WebExtensionTabDriver operates the approved tab through tabs and scripting APIs', async () => {
  const tab: WebExtensionTab = { id: 7, url: 'https://example.test/start', windowId: 3 };
  const calls: string[] = [];
  const api: WebExtensionApi = {
    tabs: {
      async get() {
        calls.push('tabs.get');
        return { ...tab };
      },
      async update(_tabId, properties) {
        calls.push(properties.url ? 'tabs.navigate' : 'tabs.focus');
        if (properties.url) tab.url = properties.url;
        return { ...tab };
      },
    },
    scripting: {
      async executeScript(details) {
        calls.push(details.args ? 'script.ready' : 'script.content');
        return [{ result: details.args ? true : '<html><main>chapter</main></html>' }];
      },
    },
    windows: {
      async update() {
        calls.push('window.focus');
      },
    },
  };
  const driver = new WebExtensionTabDriver(api);
  const signal = new AbortController().signal;

  assert.equal(await driver.navigate(7, 'https://example.test/chapter', signal), 'https://example.test/chapter');
  assert.equal(await driver.content(7, signal), '<html><main>chapter</main></html>');
  await driver.prepareContent(7, 'scroll-through', 1_000, signal);
  await driver.focus(7, signal);

  assert.deepEqual(calls, [
    'tabs.navigate',
    'script.ready',
    'tabs.get',
    'script.content',
    'script.ready',
    'tabs.focus',
    'window.focus',
  ]);
});

test('WebExtensionTabDriver rejects an aborted command before touching the tab', async () => {
  const controller = new AbortController();
  controller.abort();
  const driver = new WebExtensionTabDriver({
    tabs: {
      async get() { throw new Error('must not run'); },
      async update() { throw new Error('must not run'); },
    },
    scripting: {
      async executeScript() { throw new Error('must not run'); },
    },
  });

  await assert.rejects(() => driver.currentUrl(1, controller.signal), /cancelled/);
});
