import { describe, it, expect, beforeEach } from '@jest/globals';
import { SsrfProtection } from '../../../src/security/ssrf-protection';
import { ComicError, ErrorType } from '../../../src/error/types';

describe('SsrfProtection', () => {
  let protection: SsrfProtection;

  beforeEach(() => {
    protection = new SsrfProtection();
  });

  it('should allow valid public URLs', () => {
    expect(() => protection.validateUrl('https://example.com/comic/1')).not.toThrow();
    expect(() => protection.validateUrl('http://example.com/comic/1')).not.toThrow();
  });

  it('should block private IPs', () => {
    const privateUrls = [
      'http://127.0.0.1/test',
      'http://192.168.1.1/test',
      'http://10.0.0.1/test',
      'http://172.16.0.1/test',
      'http://localhost/test',
    ];

    for (const url of privateUrls) {
      expect(() => protection.validateUrl(url)).toThrow(ComicError);
    }
  });

  it('should block non-HTTP protocols', () => {
    const invalidProtocols = [
      'file:///etc/passwd',
      'ftp://example.com/file',
      'data:text/plain,hello',
    ];

    for (const url of invalidProtocols) {
      expect(() => protection.validateUrl(url)).toThrow(ComicError);
    }
  });

  it('should enforce domain whitelist when configured', () => {
    protection = new SsrfProtection(['allowed.com']);

    expect(() => protection.validateUrl('https://allowed.com/test')).not.toThrow();
    expect(() => protection.validateUrl('https://blocked.com/test')).toThrow(ComicError);
  });

  it('should validate redirect chains', () => {
    const validChain = [
      'https://example.com/a',
      'https://example.com/b',
    ];
    expect(() => protection.validateRedirectChain(validChain)).not.toThrow();
  });

  it('should block too many redirects', () => {
    const longChain = Array(7).fill('https://example.com/redirect');
    expect(() => protection.validateRedirectChain(longChain)).toThrow(ComicError);
  });

  it('should manage allowed domains dynamically', () => {
    protection = new SsrfProtection(['allowed.com']);

    expect(() => protection.validateUrl('https://allowed.com/test')).not.toThrow();
    expect(() => protection.validateUrl('https://blocked.com/test')).toThrow(ComicError);

    protection.addAllowedDomain('new-site.com');
    expect(() => protection.validateUrl('https://new-site.com/test')).not.toThrow();

    protection.removeAllowedDomain('new-site.com');
    // blocked.com is still not in the list (only allowed.com is)
    expect(() => protection.validateUrl('https://blocked.com/test')).toThrow(ComicError);
  });
});
