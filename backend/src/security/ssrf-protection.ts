import { URL } from 'node:url';
import { ComicError, ErrorType } from '../error/types';

const PRIVATE_IP_RANGES = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
];

const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const MAX_REDIRECTS = 5;

export class SsrfProtection {
  private allowedDomains: Set<string>;

  constructor(allowedDomains: string[] = []) {
    this.allowedDomains = new Set(allowedDomains.map((d) => d.toLowerCase()));
  }

  validateUrl(url: string): void {
    const parsed = new URL(url);

    this.validateProtocol(parsed.protocol);
    this.validateHostname(parsed.hostname);

    if (this.allowedDomains.size > 0) {
      this.validateDomain(parsed.hostname);
    }
  }

  validateRedirectChain(urls: string[]): void {
    if (urls.length > MAX_REDIRECTS) {
      throw new ComicError(
        `Too many redirects (max: ${MAX_REDIRECTS})`,
        ErrorType.SSRF_ERROR
      );
    }

    for (const url of urls) {
      this.validateUrl(url);
    }
  }

  addAllowedDomain(domain: string): void {
    this.allowedDomains.add(domain.toLowerCase());
  }

  removeAllowedDomain(domain: string): void {
    this.allowedDomains.delete(domain.toLowerCase());
  }

  private validateProtocol(protocol: string): void {
    if (!ALLOWED_PROTOCOLS.includes(protocol)) {
      throw new ComicError(
        `Protocol "${protocol}" is not allowed. Only ${ALLOWED_PROTOCOLS.join(', ')} are permitted.`,
        ErrorType.SSRF_ERROR
      );
    }
  }

  private validateHostname(hostname: string): void {
    for (const pattern of PRIVATE_IP_RANGES) {
      if (pattern.test(hostname)) {
        throw new ComicError(
          `Access to private IP "${hostname}" is not allowed.`,
          ErrorType.SSRF_ERROR
        );
      }
    }

    if (hostname === 'localhost' || hostname === '[::1]') {
      throw new ComicError(
        `Access to localhost is not allowed.`,
        ErrorType.SSRF_ERROR
      );
    }
  }

  private validateDomain(hostname: string): void {
    if (!this.allowedDomains.has(hostname.toLowerCase())) {
      throw new ComicError(
        `Domain "${hostname}" is not in the allowed list.`,
        ErrorType.SSRF_ERROR
      );
    }
  }
}
