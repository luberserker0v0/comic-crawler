import type { BrowserPageDriver } from './executors';
import { BrowserClientError } from './errors';
import { prepareScrollableContent } from './content-preparation';

export interface WebExtensionTab {
  id?: number;
  url?: string;
  windowId?: number;
}

export interface WebExtensionApi {
  tabs: {
    get(tabId: number): Promise<WebExtensionTab>;
    update(tabId: number, properties: { active?: boolean; url?: string }): Promise<WebExtensionTab>;
  };
  scripting: {
    executeScript(details: {
      target: { tabId: number };
      func: (...args: any[]) => unknown;
      args?: unknown[];
    }): Promise<Array<{ result?: unknown }>>;
  };
  windows?: {
    update(windowId: number, properties: { focused: boolean }): Promise<unknown>;
  };
}

export class WebExtensionTabDriver implements BrowserPageDriver<number> {
  constructor(private readonly api: WebExtensionApi) {}

  async currentUrl(tabId: number, signal: AbortSignal): Promise<string> {
    assertNotAborted(signal);
    const tab = await this.api.tabs.get(tabId);
    assertNotAborted(signal);
    return requireTabUrl(tab, tabId);
  }

  async navigate(tabId: number, url: string, signal: AbortSignal): Promise<string> {
    assertNotAborted(signal);
    await this.api.tabs.update(tabId, { url });
    await this.waitForReady(tabId, undefined, signal);
    return this.currentUrl(tabId, signal);
  }

  async content(tabId: number, signal: AbortSignal): Promise<string> {
    assertNotAborted(signal);
    const [result] = await this.api.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.outerHTML,
    });
    assertNotAborted(signal);
    if (typeof result?.result !== 'string') {
      throw new BrowserClientError('The browser tab did not return rendered HTML.', 'BROWSER_CLOSED', true);
    }
    return result.result;
  }

  async waitForReady(tabId: number, timeoutMs = 30_000, signal: AbortSignal): Promise<void> {
    assertNotAborted(signal);
    const [result] = await this.api.scripting.executeScript({
      target: { tabId },
      func: async (timeout: number) => {
        const deadline = Date.now() + timeout;
        while (document.readyState !== 'interactive' && document.readyState !== 'complete') {
          if (Date.now() >= deadline) return false;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return true;
      },
      args: [normalizeTimeout(timeoutMs)],
    });
    assertNotAborted(signal);
    if (result?.result !== true) {
      throw new BrowserClientError('The browser tab did not become ready before the timeout.', 'TIMEOUT', true);
    }
  }

  async prepareContent(
    tabId: number,
    strategy: 'scroll-through',
    timeoutMs = 30_000,
    signal: AbortSignal
  ): Promise<void> {
    assertNotAborted(signal);
    if (strategy !== 'scroll-through') {
      throw new BrowserClientError(`Unsupported content preparation strategy "${strategy}".`, 'UNSUPPORTED_COMMAND');
    }
    await prepareScrollableContent(
      (script, argument) => this.executePreparationScript(tabId, script, argument),
      normalizeTimeout(timeoutMs)
    );
    assertNotAborted(signal);
  }

  private async executePreparationScript<Argument, Result>(
    tabId: number,
    script: (argument: Argument) => Result | Promise<Result>,
    argument: Argument
  ): Promise<Result> {
    const [result] = await this.api.scripting.executeScript({
      target: { tabId },
      func: script,
      args: [argument],
    });
    return result?.result as Result;
  }

  async focus(tabId: number, signal: AbortSignal): Promise<void> {
    assertNotAborted(signal);
    const tab = await this.api.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) await this.api.windows?.update(tab.windowId, { focused: true });
    assertNotAborted(signal);
  }
}

function requireTabUrl(tab: WebExtensionTab, tabId: number): string {
  if (!tab.url) throw new BrowserClientError(`Browser tab "${tabId}" is closed or has no accessible URL.`, 'BROWSER_CLOSED');
  return tab.url;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserClientError('Browser operation was cancelled.', 'CANCELLED');
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 30_000;
  return Math.max(1, Math.floor(value));
}
