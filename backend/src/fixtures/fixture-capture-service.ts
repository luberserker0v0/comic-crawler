import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DomReadinessTarget,
  FixtureSummary,
} from '@comiccrawler/shared';
import type { ChallengeDiscoveryService } from '../challenge';
import { DomReadinessChecker } from './dom-readiness';

export interface CaptureFixtureInput {
  challengeDiscoveryId: string;
  target: DomReadinessTarget;
  functionId?: string;
  expectedUrl?: string;
  settle?: boolean;
  allowNavigate?: boolean;
}

export class FixtureCaptureService {
  private readonly readiness = new DomReadinessChecker();

  constructor(
    private readonly challengeDiscoveryService: ChallengeDiscoveryService,
    private readonly workspaceRoot = process.env.AGENT_WORKSPACE_PATH ?? join(process.cwd(), 'data', 'agent-workspaces')
  ) {}

  async captureBrowserDocument(input: CaptureFixtureInput): Promise<FixtureSummary> {
    const job = await this.challengeDiscoveryService.get(input.challengeDiscoveryId);
    if (!job) {
      throw new Error(`Challenge discovery job "${input.challengeDiscoveryId}" was not found.`);
    }
    if (job.status !== 'ready') {
      throw new Error(`Challenge discovery job "${input.challengeDiscoveryId}" is not ready.`);
    }

    const snapshot = await this.challengeDiscoveryService.readCdpPageSnapshot(input.challengeDiscoveryId, job.browserCdpUrl, {
      settle: input.settle,
      allowNavigate: input.allowNavigate,
    });
    if (input.expectedUrl && !sameDocumentPath(snapshot.page.url, input.expectedUrl)) {
      throw new Error(`Verified browser page does not match the expected URL. Browser page: ${snapshot.page.url}`);
    }

    const readiness = this.readiness.check({
      url: snapshot.page.url,
      html: snapshot.page.html,
      target: input.target,
      functionId: input.functionId,
    });
    if (readiness.status === 'human_verification_required') {
      throw new Error('Captured browser page still requires human verification.');
    }

    const capturedAt = new Date().toISOString();
    const domain = new URL(snapshot.page.url).hostname;
    const id = `${Date.now()}-${sanitizePathSegment(input.functionId ?? input.target)}`;
    const fixtureDir = join(this.workspaceRoot, 'fixtures', sanitizePathSegment(domain), id);
    await mkdir(fixtureDir, { recursive: true });
    const htmlPath = join(fixtureDir, 'page.html');
    const metaPath = join(fixtureDir, 'meta.md');
    const readinessPath = join(fixtureDir, 'readiness.md');

    await writeFile(htmlPath, normalizeFixtureHtml(snapshot.page.html), 'utf-8');
    await writeFile(metaPath, [
      '# Verified Fixture',
      '',
      `- id: ${id}`,
      `- url: ${snapshot.page.url}`,
      `- title: ${snapshot.page.title}`,
      `- domain: ${domain}`,
      `- target: ${input.target}`,
      `- htmlLength: ${snapshot.page.html.length}`,
      `- capturedAt: ${capturedAt}`,
      `- source: challenge-discovery ${input.challengeDiscoveryId}`,
      '',
    ].join('\n'), 'utf-8');
    await writeFile(readinessPath, [
      '# DOM Readiness',
      '',
      `- status: ${readiness.status}`,
      `- target: ${readiness.target}`,
      `- confidence: ${readiness.confidence}`,
      `- recommendedAction: ${readiness.recommendedAction}`,
      '',
      '## Reasons',
      '',
      ...readiness.reasons.map((reason) => `- ${reason}`),
      '',
    ].join('\n'), 'utf-8');

    return {
      id,
      domain,
      url: snapshot.page.url,
      title: snapshot.page.title,
      htmlLength: snapshot.page.html.length,
      capturedAt,
      path: htmlPath,
      readiness,
    };
  }

  async readFixture(domain: string, id: string, includeHtml = false): Promise<{ fixture: FixtureSummary; html?: string }> {
    const fixtureDir = join(this.workspaceRoot, 'fixtures', sanitizePathSegment(domain), sanitizePathSegment(id));
    const htmlPath = join(fixtureDir, 'page.html');
    const metaPath = join(fixtureDir, 'meta.md');
    const html = await readFile(htmlPath, 'utf-8');
    const meta = parseFixtureMeta(await readFile(metaPath, 'utf-8').catch(() => ''));
    const url = meta.url ?? `https://${domain}/`;
    const target = parseDomReadinessTarget(meta.target);
    const readiness = this.readiness.check({ url, html, target });
    return {
      fixture: {
        id,
        domain,
        url,
        title: meta.title ?? '',
        htmlLength: html.length,
        capturedAt: meta.capturedAt ?? '',
        path: htmlPath,
        readiness,
      },
      ...(includeHtml ? { html } : {}),
    };
  }
}

function parseDomReadinessTarget(value: string | undefined): DomReadinessTarget {
  if (value === 'metadata' || value === 'chapterImages' || value === 'verification' || value === 'common') {
    return value;
  }
  return 'metadata';
}

export function normalizeFixtureHtml(html: string): string {
  return html.replace(/\r\n?/g, '\n').trimEnd() + '\n';
}

function sameDocumentPath(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.hostname === rightUrl.hostname && normalizePathname(leftUrl.pathname) === normalizePathname(rightUrl.pathname);
  } catch {
    return false;
  }
}

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 120) || 'snapshot';
}

function parseFixtureMeta(markdown: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^- ([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$/);
    if (match) {
      result[match[1]!] = match[2]!.trim();
    }
  }
  return result;
}
