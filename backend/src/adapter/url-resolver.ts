import { URL } from 'node:url';
import { ComicError, ErrorType } from '../error/types';

export interface UrlMatchResult {
  adapterId: string;
  domain: string;
  path: string;
  params: Record<string, string>;
}

export class UrlResolver {
  private allowedDomains = new Set<string>();

  addDomain(domain: string): void {
    this.allowedDomains.add(domain.toLowerCase());
  }

  removeDomain(domain: string): void {
    this.allowedDomains.delete(domain.toLowerCase());
  }

  parse(url: string): UrlMatchResult {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    if (!this.isDomainAllowed(hostname)) {
      throw new ComicError(
        `Domain "${hostname}" is not allowed`,
        ErrorType.VALIDATION_ERROR
      );
    }

    return {
      adapterId: this.resolveAdapterId(hostname),
      domain: hostname,
      path: parsed.pathname,
      params: this.extractParams(parsed),
    };
  }

  normalize(url: string): string {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  }

  isValid(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.isDomainAllowed(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  private isDomainAllowed(hostname: string): boolean {
    if (this.allowedDomains.size === 0) return true;

    for (const allowed of this.allowedDomains) {
      if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
        return true;
      }
    }
    return false;
  }

  private resolveAdapterId(hostname: string): string {
    for (const allowed of this.allowedDomains) {
      if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
        return allowed.replace(/\./g, '-');
      }
    }
    return hostname.replace(/\./g, '-');
  }

  private extractParams(parsed: URL): Record<string, string> {
    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }
}
