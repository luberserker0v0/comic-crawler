import { describe, it, expect, beforeEach } from '@jest/globals';
import { UrlResolver } from '../../../src/adapter/url-resolver';

let resolver: UrlResolver;

describe('UrlResolver', () => {
  UrlResolverTestGroup1();
});

function UrlResolverTestGroup1(): void {
  beforeEach(UrlResolverTestScenario1);
  it('should parse valid URLs', UrlResolverTestShouldParseValidURLs);
  it('should normalize URLs', UrlResolverTestShouldNormalizeURLs);
  it('should validate URLs', UrlResolverTestShouldValidateURLs);
  it('should enforce domain whitelist', UrlResolverTestShouldEnforceDomainWhitelist);
  it('should manage domains dynamically', UrlResolverTestShouldManageDomainsDynamically);
  it('should extract path parameters', UrlResolverTestShouldExtractPathParameters);
  it('should resolve adapter ID from domain', UrlResolverTestShouldResolveAdapterIDFromDomain);
}

function UrlResolverTestScenario1() {
    resolver = new UrlResolver();
}

function UrlResolverTestShouldParseValidURLs() {
    const result = resolver.parse('https://example.com/comic/1?page=1');
    expect(result.domain).toBe('example.com');
    expect(result.path).toBe('/comic/1');
    expect(result.params).toEqual({ page: '1' });
}

function UrlResolverTestShouldNormalizeURLs() {
    const normalized = resolver.normalize('https://EXAMPLE.COM/Comic/1');
    expect(normalized).toContain('example.com');
}

function UrlResolverTestShouldValidateURLs() {
    expect(resolver.isValid('https://example.com/comic/1')).toBe(true);
    expect(resolver.isValid('not-a-url')).toBe(false);
}

function UrlResolverTestShouldEnforceDomainWhitelist() {
    resolver.addDomain('allowed.com');
    expect(resolver.isValid('https://allowed.com/test')).toBe(true);
    expect(resolver.isValid('https://blocked.com/test')).toBe(false);
    expect(resolver.isValid('https://sub.allowed.com/test')).toBe(true);
}

function UrlResolverTestShouldManageDomainsDynamically() {
    resolver.addDomain('test.com');
    resolver.addDomain('other.com');
    expect(resolver.isValid('https://test.com')).toBe(true);
    resolver.removeDomain('test.com');
    expect(resolver.isValid('https://test.com')).toBe(false);
    expect(resolver.isValid('https://other.com')).toBe(true);
}

function UrlResolverTestShouldExtractPathParameters() {
    const result = resolver.parse('https://example.com/comic/1?sort=date&order=asc');
    expect(result.params.sort).toBe('date');
    expect(result.params.order).toBe('asc');
}

function UrlResolverTestShouldResolveAdapterIDFromDomain() {
    resolver.addDomain('manga-site.com');
    const result = resolver.parse('https://manga-site.com/comic/1');
    expect(result.adapterId).toBe('manga-site-com');
}
