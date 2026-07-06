import { describe, it, expect, beforeEach } from '@jest/globals';
import { UrlResolver } from '../../../src/adapter/url-resolver';

describe('UrlResolver', () => {
  let resolver: UrlResolver;

  beforeEach(() => {
    resolver = new UrlResolver();
  });

  it('should parse valid URLs', () => {
    const result = resolver.parse('https://example.com/comic/1?page=1');

    expect(result.domain).toBe('example.com');
    expect(result.path).toBe('/comic/1');
    expect(result.params).toEqual({ page: '1' });
  });

  it('should normalize URLs', () => {
    const normalized = resolver.normalize('https://EXAMPLE.COM/Comic/1');
    expect(normalized).toContain('example.com');
  });

  it('should validate URLs', () => {
    expect(resolver.isValid('https://example.com/comic/1')).toBe(true);
    expect(resolver.isValid('not-a-url')).toBe(false);
  });

  it('should enforce domain whitelist', () => {
    resolver.addDomain('allowed.com');

    expect(resolver.isValid('https://allowed.com/test')).toBe(true);
    expect(resolver.isValid('https://blocked.com/test')).toBe(false);
    expect(resolver.isValid('https://sub.allowed.com/test')).toBe(true);
  });

  it('should manage domains dynamically', () => {
    resolver.addDomain('test.com');
    resolver.addDomain('other.com');
    expect(resolver.isValid('https://test.com')).toBe(true);

    resolver.removeDomain('test.com');
    expect(resolver.isValid('https://test.com')).toBe(false);
    expect(resolver.isValid('https://other.com')).toBe(true);
  });

  it('should extract path parameters', () => {
    const result = resolver.parse('https://example.com/comic/1?sort=date&order=asc');

    expect(result.params.sort).toBe('date');
    expect(result.params.order).toBe('asc');
  });

  it('should resolve adapter ID from domain', () => {
    resolver.addDomain('manga-site.com');
    const result = resolver.parse('https://manga-site.com/comic/1');

    expect(result.adapterId).toBe('manga-site-com');
  });
});
