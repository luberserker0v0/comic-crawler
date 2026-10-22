import assert from 'node:assert/strict';
import test from 'node:test';
import { WebExtensionTabDriver, type WebExtensionApi, type WebExtensionTab } from '../src';

test('WebExtensionTabDriver operates the approved tab through tabs and scripting APIs', testApprovedTab);
test('WebExtensionTabDriver rejects an aborted command before touching the tab', testAbortedCommand);

async function testApprovedTab(): Promise<void> {
  const tab: WebExtensionTab = { id: 7, url: 'https://example.test/start', windowId: 3 };
  const calls: string[] = [];
  const driver = new WebExtensionTabDriver(createApi(tab, calls));
  const signal = new AbortController().signal;
  assert.equal(await driver.navigate(7, 'https://example.test/chapter', signal), 'https://example.test/chapter');
  assert.equal(await driver.content(7, signal), '<html><main>chapter</main></html>');
  await driver.prepareContent(7, 'scroll-through', 1_000, signal);
  await driver.focus(7, signal);
  assert.ok(calls.includes('script.initializeScrollPreparation'));
  assert.ok(calls.includes('script.scrollPreparationBottomStep'));
  assert.deepEqual(calls.slice(-2), ['tabs.focus', 'window.focus']);
}

function createApi(tab: WebExtensionTab, calls: string[]): WebExtensionApi {
  return {
    tabs: tabApi(tab, calls),
    scripting: scriptingApi(calls),
    windows: { async update() { calls.push('window.focus'); } },
  };
}

function tabApi(tab: WebExtensionTab, calls: string[]): WebExtensionApi['tabs'] {
  return {
    async get() { calls.push('tabs.get'); return { ...tab }; },
    async update(_tabId, properties) {
      calls.push(properties.url ? 'tabs.navigate' : 'tabs.focus');
      if (properties.url) tab.url = properties.url;
      return { ...tab };
    },
  };
}

function scriptingApi(calls: string[]): WebExtensionApi['scripting'] {
  return { async executeScript(details) {
    calls.push(`script.${details.func.name || 'anonymous'}`);
    if (details.func.name === 'initializeScrollPreparation') return [{ result: 0 }];
    if (details.func.name === 'scrollPreparationBottomStep') return [{ result: true }];
    if (!details.args) return [{ result: '<html><main>chapter</main></html>' }];
    return [{ result: true }];
  } };
}

async function testAbortedCommand(): Promise<void> {
  const controller = new AbortController();
  controller.abort();
  const driver = new WebExtensionTabDriver(failingApi());
  await assert.rejects(() => driver.currentUrl(1, controller.signal), /cancelled/);
}

function failingApi(): WebExtensionApi {
  return {
    tabs: {
      async get() { throw new Error('must not run'); },
      async update() { throw new Error('must not run'); },
    },
    scripting: { async executeScript() { throw new Error('must not run'); } },
  };
}
