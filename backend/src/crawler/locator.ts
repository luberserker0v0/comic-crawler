export interface LocatorOptions {
  timeout?: number;
  visible?: boolean;
}

export interface LocatorResult {
  text: string;
  html: string;
  attr(name: string): string | undefined;
  all(): Promise<LocatorResult[]>;
  first(): Promise<LocatorResult | null>;
  count(): Promise<number>;
}

export interface ILocator {
  selector: string;
  text(): Promise<string>;
  html(): Promise<string>;
  attr(name: string): Promise<string | undefined>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  all(): Promise<ILocator[]>;
  first(): Promise<ILocator | null>;
  count(): Promise<number>;
  waitFor(options?: LocatorOptions): Promise<void>;
  evaluate<R>(fn: (el: Element) => R): Promise<R>;
  evaluateAll<R>(fn: (els: Element[]) => R): Promise<R>;
}
