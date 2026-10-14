import type { BrowserContext } from 'playwright';

export interface VerifiedBrowserSession {
  hostname: string;
  wsEndpoint: string;
  context: BrowserContext;
  verifiedAt: string;
  sourceJobId?: string;
}

export class VerifiedBrowserSessionRegistry {
  private readonly sessions = new Map<string, VerifiedBrowserSession>();

  register(session: VerifiedBrowserSession): void {
    this.sessions.set(normalizeHostname(session.hostname), {
      ...session,
      hostname: normalizeHostname(session.hostname),
    });
  }

  getByUrl(url: string): VerifiedBrowserSession | undefined {
    return this.sessions.get(normalizeHostname(new URL(url).hostname));
  }

  list(): VerifiedBrowserSession[] {
    return Array.from(this.sessions.values());
  }

  clear(): void {
    this.sessions.clear();
  }

  deleteBySourceJobId(sourceJobId: string): void {
    for (const [hostname, session] of this.sessions) {
      if (session.sourceJobId === sourceJobId) this.sessions.delete(hostname);
    }
  }
}

const globalVerifiedBrowserSessionRegistry = new VerifiedBrowserSessionRegistry();

export function getGlobalVerifiedBrowserSessionRegistry(): VerifiedBrowserSessionRegistry {
  return globalVerifiedBrowserSessionRegistry;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}
