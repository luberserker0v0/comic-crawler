import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
} from '../../base';

export class ExampleSiteAdapter extends AdapterBase {
  readonly id = 'example-site';
  readonly name = 'Example Site';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  readonly capabilities = {
    verification: true,
    metadata: false,
    chapterImages: false,
  };

  readonly common = new ExampleCommonCapability(this);
  readonly verification = new ExampleVerificationCapability(this);
}

class ExampleCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'example.com' &&
        (parsed.pathname === '/manga' ||
          parsed.pathname.startsWith('/manga/') ||
          parsed.pathname === '/read' ||
          parsed.pathname.startsWith('/read/'));
    } catch {
      return false;
    }
  }
}

class ExampleVerificationCapability extends VerificationCapability {
  detectVerificationRequired(input: string): boolean {
    return /human verification|captcha|blocked|challenge|cloudflare|HTTP\s+(?:403|429|503)\b/i.test(input);
  }

  describeVerificationHandoff(): Record<string, unknown> {
    return {
      supported: true,
      flow: 'Task enters waiting_verification and the user completes verification through the task detail handoff.',
    };
  }
}
