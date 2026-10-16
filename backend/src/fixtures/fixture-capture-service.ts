import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import type {
  DomReadinessTarget,
  FixtureSummary,
  IComicAdapter,
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

export interface CaptureApprovedAdapterFixtureInput {
  sourceDiscoveryId: string;
  adapter: IComicAdapter;
  target: 'full' | 'chapter-only';
  url: string;
  html: string;
  title?: string;
}

export interface ApprovedFixtureExpectation {
  schemaVersion: 1;
  adapterId: string;
  sourceDiscoveryId: string;
  url: string;
  functionIds: string[];
  results: Record<string, unknown>;
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

    const snapshot = await this.challengeDiscoveryService.readRemotePageSnapshot(
      input.challengeDiscoveryId,
      {
        settle: input.settle,
        allowNavigate: input.allowNavigate,
      }
    );
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

  async captureApprovedAdapterFixture(input: CaptureApprovedAdapterFixtureInput): Promise<FixtureSummary> {
    const target: DomReadinessTarget = input.target === 'chapter-only' ? 'chapterImages' : 'metadata';
    const readiness = this.readiness.check({
      url: input.url,
      html: input.html,
      target,
    });
    if (readiness.status === 'human_verification_required') {
      throw new Error('Accepted adapter page still requires human verification. Complete handoff before accepting it.');
    }

    const functionIds = getApprovalFunctionIds(input.adapter, input.target);
    const document = cheerio.load(input.html);
    const results: Record<string, unknown> = {};
    for (const functionId of functionIds) {
      results[functionId] = await runFixtureFunction(input.adapter, functionId, document, input.url);
    }
    assertUsefulApprovalResult(input.target, results);

    const capturedAt = new Date().toISOString();
    const domain = new URL(input.url).hostname;
    const id = `${Date.now()}-${sanitizePathSegment(input.adapter.id)}-${sanitizePathSegment(target)}`;
    const fixtureDir = join(this.workspaceRoot, 'fixtures', sanitizePathSegment(domain), id);
    await mkdir(fixtureDir, { recursive: true });
    const htmlPath = join(fixtureDir, 'page.html');
    const expectedPath = join(fixtureDir, 'expected.json');
    const metaPath = join(fixtureDir, 'meta.md');
    const expectation: ApprovedFixtureExpectation = {
      schemaVersion: 1,
      adapterId: input.adapter.id,
      sourceDiscoveryId: input.sourceDiscoveryId,
      url: input.url,
      functionIds,
      results,
    };

    await writeFile(htmlPath, normalizeFixtureHtml(input.html), 'utf-8');
    await writeFile(expectedPath, `${JSON.stringify(expectation, null, 2)}\n`, 'utf-8');
    await writeFile(metaPath, [
      '# Approved Adapter Fixture',
      '',
      `- id: ${id}`,
      `- url: ${input.url}`,
      `- title: ${input.title ?? ''}`,
      `- domain: ${domain}`,
      `- target: ${target}`,
      `- htmlLength: ${input.html.length}`,
      `- capturedAt: ${capturedAt}`,
      `- adapterId: ${input.adapter.id}`,
      `- sourceDiscoveryId: ${input.sourceDiscoveryId}`,
      `- functionIds: ${functionIds.join(',')}`,
      '',
    ].join('\n'), 'utf-8');

    return {
      id,
      domain,
      url: input.url,
      title: input.title ?? '',
      htmlLength: input.html.length,
      capturedAt,
      path: htmlPath,
      expectedPath,
      adapterId: input.adapter.id,
      sourceDiscoveryId: input.sourceDiscoveryId,
      functionIds,
      readiness,
    };
  }

  async verifyApprovedAdapterFixture(domain: string, id: string, adapter: IComicAdapter): Promise<{
    fixture: FixtureSummary;
    passed: boolean;
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
  }> {
    const fixtureDir = join(this.workspaceRoot, 'fixtures', sanitizePathSegment(domain), sanitizePathSegment(id));
    const expectation = JSON.parse(await readFile(join(fixtureDir, 'expected.json'), 'utf-8')) as ApprovedFixtureExpectation;
    if (expectation.adapterId !== adapter.id) {
      throw new Error(`Fixture expects adapter "${expectation.adapterId}", got "${adapter.id}".`);
    }
    const detail = await this.readFixture(domain, id, true);
    const document = cheerio.load(detail.html ?? '');
    const actual: Record<string, unknown> = {};
    for (const functionId of expectation.functionIds) {
      actual[functionId] = await runFixtureFunction(adapter, functionId, document, expectation.url);
    }
    return {
      fixture: {
        ...detail.fixture,
        expectedPath: join(fixtureDir, 'expected.json'),
        adapterId: expectation.adapterId,
        sourceDiscoveryId: expectation.sourceDiscoveryId,
        functionIds: expectation.functionIds,
      },
      passed: stableJson(actual) === stableJson(expectation.results),
      expected: expectation.results,
      actual,
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

export async function runFixtureFunction(adapter: IComicAdapter, functionId: string, document: cheerio.CheerioAPI, url: string): Promise<unknown> {
  if (functionId === 'extractTitle') return { title: await adapter.extractTitle?.(document, url) };
  if (functionId === 'extractAuthor') return { author: await adapter.extractAuthor?.(document, url) };
  if (functionId === 'extractDescription') return { description: await adapter.extractDescription?.(document, url) };
  if (functionId === 'extractCoverUrl') return { coverUrl: await adapter.extractCoverUrl?.(document, url) };
  if (functionId === 'extractTags') return { tags: await adapter.extractTags?.(document, url) };
  if (functionId === 'extractStatus') return { status: await adapter.extractStatus?.(document, url) };
  if (functionId === 'extractChapterList') return { chapters: await adapter.extractChapterList?.(document, url) };
  if (functionId === 'extractChapterImageUrls') return { imageUrls: await adapter.extractChapterImageUrls?.(document, url) };
  if (functionId === 'matchUrl') return { matched: adapter.matchUrl(url) };
  throw new Error(`Function "${functionId}" cannot be tested against a fixture.`);
}

function getApprovalFunctionIds(adapter: IComicAdapter, target: 'full' | 'chapter-only'): string[] {
  if (target === 'chapter-only') return ['matchUrl', 'extractChapterImageUrls'];
  return [
    'matchUrl',
    'extractTitle',
    'extractAuthor',
    'extractDescription',
    'extractCoverUrl',
    'extractTags',
    'extractStatus',
    'extractChapterList',
  ].filter((functionId) => functionId === 'matchUrl' || typeof (adapter as unknown as Record<string, unknown>)[functionId] === 'function');
}

function assertUsefulApprovalResult(target: 'full' | 'chapter-only', results: Record<string, unknown>): void {
  const matched = (results.matchUrl as { matched?: boolean } | undefined)?.matched;
  if (!matched) throw new Error('Accepted adapter does not match its reviewed URL.');
  if (target === 'chapter-only') {
    const imageUrls = (results.extractChapterImageUrls as { imageUrls?: unknown[] } | undefined)?.imageUrls;
    if (!imageUrls?.length) throw new Error('Accepted chapter adapter returned no image URLs for its fixture page.');
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
