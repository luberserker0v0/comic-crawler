import type { Locator as PWLocator, Page } from 'playwright';
import type { ILocator, LocatorOptions } from './locator';

export class PlaywrightLocator implements ILocator {
  private locator: PWLocator;

  constructor(page: Page, selector: string) {
    this.locator = page.locator(selector);
  }

  get selector(): string {
    return '';
  }

  async text(): Promise<string> {
    return (await this.locator.textContent()) ?? '';
  }

  async html(): Promise<string> {
    return await this.locator.innerHTML();
  }

  async attr(name: string): Promise<string | undefined> {
    return (await this.locator.getAttribute(name)) ?? undefined;
  }

  async click(): Promise<void> {
    await this.locator.click();
  }

  async fill(value: string): Promise<void> {
    await this.locator.fill(value);
  }

  async all(): Promise<ILocator[]> {
    const count = await this.locator.count();
    const results: ILocator[] = [];
    for (let i = 0; i < count; i++) {
      results.push(new PlaywrightLocatorFromElement(this.locator.nth(i)));
    }
    return results;
  }

  async first(): Promise<ILocator | null> {
    const count = await this.locator.count();
    if (count === 0) return null;
    return new PlaywrightLocatorFromElement(this.locator.first());
  }

  async count(): Promise<number> {
    return this.locator.count();
  }

  async waitFor(options?: LocatorOptions): Promise<void> {
    await this.locator.waitFor({
      state: options?.visible ? 'visible' : 'attached',
      timeout: options?.timeout ?? 30000,
    });
  }

  async evaluate<R>(fn: (el: Element) => R): Promise<R> {
    return this.locator.evaluate(fn) as Promise<R>;
  }

  async evaluateAll<R>(fn: (els: Element[]) => R): Promise<R> {
    return this.locator.evaluateAll(fn) as Promise<R>;
  }
}

class PlaywrightLocatorFromElement implements ILocator {
  private element: PWLocator;

  constructor(element: PWLocator) {
    this.element = element;
  }

  get selector(): string {
    return '';
  }

  async text(): Promise<string> {
    return (await this.element.textContent()) ?? '';
  }

  async html(): Promise<string> {
    return await this.element.innerHTML();
  }

  async attr(name: string): Promise<string | undefined> {
    return (await this.element.getAttribute(name)) ?? undefined;
  }

  async click(): Promise<void> {
    await this.element.click();
  }

  async fill(value: string): Promise<void> {
    await this.element.fill(value);
  }

  async all(): Promise<ILocator[]> {
    return [];
  }

  async first(): Promise<ILocator | null> {
    return this;
  }

  async count(): Promise<number> {
    return 1;
  }

  async waitFor(options?: LocatorOptions): Promise<void> {
    await this.element.waitFor({
      state: options?.visible ? 'visible' : 'attached',
      timeout: options?.timeout ?? 30000,
    });
  }

  async evaluate<R>(fn: (el: Element) => R): Promise<R> {
    return this.element.evaluate(fn) as Promise<R>;
  }

  async evaluateAll<R>(fn: (els: Element[]) => R): Promise<R> {
    return this.element.evaluateAll(fn) as Promise<R>;
  }
}

export function createLocator(page: Page, selector: string): ILocator {
  return new PlaywrightLocator(page, selector);
}
