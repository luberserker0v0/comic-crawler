import * as cheerio from 'cheerio';
import type { ILocator, LocatorOptions } from './locator';

export class CheerioLocator implements ILocator {
  private $: cheerio.CheerioAPI;
  private _selector: string;

  constructor($: cheerio.CheerioAPI, selector: string) {
    this.$ = $;
    this._selector = selector;
  }

  get selector(): string {
    return this._selector;
  }

  async text(): Promise<string> {
    return this.$(this._selector).first().text().trim();
  }

  async html(): Promise<string> {
    return this.$(this._selector).first().html() ?? '';
  }

  async attr(name: string): Promise<string | undefined> {
    return this.$(this._selector).first().attr(name);
  }

  async click(): Promise<void> {
    throw new Error('CheerioLocator does not support click (static HTML only)');
  }

  async fill(_value: string): Promise<void> {
    throw new Error('CheerioLocator does not support fill (static HTML only)');
  }

  async all(): Promise<ILocator[]> {
    const elements = this.$(this._selector);
    return elements
      .map((_, el) => new CheerioLocatorFromElement(this.$, this.$(el)))
      .get();
  }

  async first(): Promise<ILocator | null> {
    const element = this.$(this._selector).first();
    if (element.length === 0) return null;
    return new CheerioLocatorFromElement(this.$, element);
  }

  async count(): Promise<number> {
    return this.$(this._selector).length;
  }

  async waitFor(_options?: LocatorOptions): Promise<void> {
    // No-op for static HTML
  }

  async evaluate<R>(fn: (el: Element) => R): Promise<R> {
    const element = this.$(this._selector).first();
    if (element.length === 0) {
      throw new Error('Element not found');
    }
    return fn(element[0] as unknown as Element);
  }

  async evaluateAll<R>(fn: (els: Element[]) => R): Promise<R> {
    const elements = this.$(this._selector).toArray();
    return fn(elements as unknown as Element[]);
  }
}

class CheerioLocatorFromElement implements ILocator {
  private $: cheerio.CheerioAPI;
  private element: cheerio.Cheerio<any>;

  constructor($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>) {
    this.$ = $;
    this.element = element;
  }

  get selector(): string {
    return '';
  }

  async text(): Promise<string> {
    return this.element.text().trim();
  }

  async html(): Promise<string> {
    return this.element.html() ?? '';
  }

  async attr(name: string): Promise<string | undefined> {
    return this.element.attr(name);
  }

  async click(): Promise<void> {
    throw new Error('CheerioLocator does not support click (static HTML only)');
  }

  async fill(_value: string): Promise<void> {
    throw new Error('CheerioLocator does not support fill (static HTML only)');
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

  async waitFor(_options?: LocatorOptions): Promise<void> {
    // No-op for static HTML
  }

  async evaluate<R>(fn: (el: Element) => R): Promise<R> {
    return fn(this.element[0] as unknown as Element);
  }

  async evaluateAll<R>(fn: (els: Element[]) => R): Promise<R> {
    return fn([this.element[0]] as unknown as Element[]);
  }
}

export function createCheerioLocator($: cheerio.CheerioAPI, selector: string): ILocator {
  return new CheerioLocator($, selector);
}
