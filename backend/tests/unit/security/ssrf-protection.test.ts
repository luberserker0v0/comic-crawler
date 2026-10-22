import { describe, it, expect, beforeEach } from '@jest/globals';
import { SsrfProtection } from '../../../src/security/ssrf-protection';
import { ComicError } from '../../../src/error/types';

let protection: SsrfProtection;

describe('SsrfProtection', () => {
  SsrfProtectionTestGroup1();
});

function SsrfProtectionTestGroup1(): void {
  beforeEach(SsrfProtectionTestScenario1);
  it('should allow valid public URLs', SsrfProtectionTestShouldAllowValidPublicURLs);
  it('should block private IPs', SsrfProtectionTestShouldBlockPrivateIPs);
  it('should block non-HTTP protocols', SsrfProtectionTestShouldBlockNonHTTPProtocols);
  it('should enforce domain whitelist when configured', SsrfProtectionTestShouldEnforceDomainWhitelistWhenConfigured);
  it('should validate redirect chains', SsrfProtectionTestShouldValidateRedirectChains);
  it('should block too many redirects', SsrfProtectionTestShouldBlockTooManyRedirects);
  it('should manage allowed domains dynamically', SsrfProtectionTestShouldManageAllowedDomainsDynamically);
}

function SsrfProtectionTestScenario1() {
    protection = new SsrfProtection();
}

function SsrfProtectionTestShouldAllowValidPublicURLs() {
    expect(() => protection.validateUrl('https://example.com/comic/1')).not.toThrow();
    expect(() => protection.validateUrl('http://example.com/comic/1')).not.toThrow();
}

function SsrfProtectionTestShouldBlockPrivateIPs() {
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
}

function SsrfProtectionTestShouldBlockNonHTTPProtocols() {
    const invalidProtocols = [
        'file:///etc/passwd',
        'ftp://example.com/file',
        'data:text/plain,hello',
    ];
    for (const url of invalidProtocols) {
        expect(() => protection.validateUrl(url)).toThrow(ComicError);
    }
}

function SsrfProtectionTestShouldEnforceDomainWhitelistWhenConfigured() {
    protection = new SsrfProtection(['allowed.com']);
    expect(() => protection.validateUrl('https://allowed.com/test')).not.toThrow();
    expect(() => protection.validateUrl('https://blocked.com/test')).toThrow(ComicError);
}

function SsrfProtectionTestShouldValidateRedirectChains() {
    const validChain = [
        'https://example.com/a',
        'https://example.com/b',
    ];
    expect(() => protection.validateRedirectChain(validChain)).not.toThrow();
}

function SsrfProtectionTestShouldBlockTooManyRedirects() {
    const longChain = Array(7).fill('https://example.com/redirect');
    expect(() => protection.validateRedirectChain(longChain)).toThrow(ComicError);
}

function SsrfProtectionTestShouldManageAllowedDomainsDynamically() {
    protection = new SsrfProtection(['allowed.com']);
    expect(() => protection.validateUrl('https://allowed.com/test')).not.toThrow();
    expect(() => protection.validateUrl('https://blocked.com/test')).toThrow(ComicError);
    protection.addAllowedDomain('new-site.com');
    expect(() => protection.validateUrl('https://new-site.com/test')).not.toThrow();
    protection.removeAllowedDomain('new-site.com');
    // blocked.com is still not in the list (only allowed.com is)
    expect(() => protection.validateUrl('https://blocked.com/test')).toThrow(ComicError);
}
