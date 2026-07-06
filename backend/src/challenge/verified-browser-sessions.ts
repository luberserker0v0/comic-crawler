export interface VerifiedBrowserSession {
  hostname: string;
  userDataDir: string;
  chromiumProfileDirectory?: string;
  cdpUrl?: string;
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
}

const globalVerifiedBrowserSessionRegistry = new VerifiedBrowserSessionRegistry();

export function getGlobalVerifiedBrowserSessionRegistry(): VerifiedBrowserSessionRegistry {
  return globalVerifiedBrowserSessionRegistry;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}
