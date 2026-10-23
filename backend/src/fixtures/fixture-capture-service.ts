import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import type {
  DomReadinessTarget,
  AdapterPackageManifest,
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
  adapterVersion: string;
  target: 'full' | 'chapter-only';
  url: string;
  html: string;
  title?: string;
}

export interface ApprovedFixtureExpectation {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: string;
  sourceDiscoveryId: string;
  url: string;
  functionIds: string[];
  results: Record<string, unknown>;
}

interface FixtureLocation {
  id: string;
  domain: string;
  directory: string;
  htmlPath: string;
  capturedAt: string;
}

export class FixtureCaptureService {
  private readonly readiness = new DomReadinessChecker();

  constructor(
    private readonly challengeDiscoveryService: ChallengeDiscoveryService,
    private readonly workspaceRoot = process.env.AGENT_WORKSPACE_PATH ?? join(process.cwd(), 'data', 'agent-workspaces')
  ) {}

  async captureBrowserDocument(input: CaptureFixtureInput): Promise<FixtureSummary> {
    await this.requireReadyChallenge(input.challengeDiscoveryId);
    const snapshot = await this.challengeDiscoveryService.readRemotePageSnapshot(input.challengeDiscoveryId,
      { settle: input.settle, allowNavigate: input.allowNavigate });
    validateExpectedUrl(snapshot.page.url, input.expectedUrl);
    const readiness = this.readiness.check({
      url: snapshot.page.url, html: snapshot.page.html,
      target: input.target, functionId: input.functionId,
    });
    if (readiness.status === 'human_verification_required')
      throw new Error('Captured browser page still requires human verification.');
    const location = await this.createLocation(snapshot.page.url, input.functionId ?? input.target);
    await writeBrowserFixture(location, snapshot.page, input, readiness);
    return { id: location.id, domain: location.domain, url: snapshot.page.url,
      title: snapshot.page.title, htmlLength: snapshot.page.html.length,
      capturedAt: location.capturedAt, path: location.htmlPath, readiness };
  }

  private async requireReadyChallenge(id: string): Promise<void> {
    const job = await this.challengeDiscoveryService.get(id);
    if (!job) throw new Error(`Challenge discovery job "${id}" was not found.`);
    if (job.status !== 'ready') throw new Error(`Challenge discovery job "${id}" is not ready.`);
  }

  private async createLocation(url: string, suffix: string): Promise<FixtureLocation> {
    const domain = new URL(url).hostname;
    const id = `${Date.now()}-${sanitizePathSegment(suffix)}`;
    const directory = join(this.workspaceRoot, 'fixtures', sanitizePathSegment(domain), id);
    await mkdir(directory, { recursive: true });
    return { id, domain, directory, htmlPath: join(directory, 'page.html'),
      capturedAt: new Date().toISOString() };
  }

  private async createApprovedLocation(input: CaptureApprovedAdapterFixtureInput,
    suffix: string): Promise<FixtureLocation> {
    const domain = new URL(input.url).hostname;
    const id = `${Date.now()}-${sanitizePathSegment(suffix)}`;
    const directory = this.approvedFixtureDirectory(input.adapter.id, input.adapterVersion, id);
    await mkdir(directory, { recursive: true });
    return { id, domain, directory, htmlPath: join(directory, 'page.html'),
      capturedAt: new Date().toISOString() };
  }

  async captureApprovedAdapterFixture(input: CaptureApprovedAdapterFixtureInput): Promise<FixtureSummary> {
    const target = input.target === 'chapter-only' ? 'chapterImages' : 'metadata';
    const readiness = this.requireApprovedReadiness(input, target);
    const functionIds = getApprovalFunctionIds(input.adapter, input.target);
    const results = await runFixtureFunctions(input.adapter, functionIds, input.html, input.url);
    assertUsefulApprovalResult(input.target, results);
    this.requireExtractionReadiness(input, target, results);
    const location = await this.createApprovedLocation(input, target);
    const expectedPath = join(location.directory, 'expected.json');
    const expectation: ApprovedFixtureExpectation = {
      schemaVersion: 1, adapterId: input.adapter.id, adapterVersion: input.adapterVersion,
      sourceDiscoveryId: input.sourceDiscoveryId,
      url: input.url, functionIds, results,
    };
    await writeApprovedFixture(location, input, target, expectation);
    return { id: location.id, domain: location.domain, url: input.url, title: input.title ?? '',
      htmlLength: input.html.length, capturedAt: location.capturedAt, path: location.htmlPath,
      expectedPath, adapterId: input.adapter.id, sourceDiscoveryId: input.sourceDiscoveryId,
      adapterVersion: input.adapterVersion, functionIds, readiness };
  }

  private requireApprovedReadiness(input: CaptureApprovedAdapterFixtureInput,
    target: DomReadinessTarget) {
    const readiness = this.readiness.check({ url: input.url, html: input.html, target });
    if (readiness.status === 'human_verification_required') throw new Error(
      'Accepted adapter page still requires human verification. Complete handoff before accepting it.');
    if (readiness.status !== 'ready') throw new Error(
      `Accepted adapter page is not complete: ${readiness.reasons.join(' ')}`);
    return readiness;
  }

  private requireExtractionReadiness(input: CaptureApprovedAdapterFixtureInput,
    target: DomReadinessTarget, results: Record<string, unknown>): void {
    if (input.target !== 'chapter-only') return;
    const readiness = this.readiness.check({ url: input.url, html: input.html,
      target, extractionResult: results.extractChapterImageUrls });
    if (readiness.status !== 'ready') throw new Error(
      `Accepted adapter extraction is incomplete: ${readiness.reasons.join(' ')}`);
  }

  async verifyApprovedAdapterFixture(manifest: AdapterPackageManifest, adapter: IComicAdapter): Promise<{
    fixture: FixtureSummary;
    passed: boolean;
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
  }> {
    const fixture = requireApprovalFixture(manifest);
    const fixtureDir = this.approvedFixtureDirectory(manifest.adapterId, manifest.version, fixture.id);
    const expectation = JSON.parse(await readFile(join(fixtureDir, 'expected.json'), 'utf-8')) as ApprovedFixtureExpectation;
    assertExpectationIdentity(expectation, manifest, adapter);
    const detail = await this.readApprovedAdapterFixture(manifest, true);
    const actual = await runFixtureFunctions(adapter, expectation.functionIds,
      detail.html ?? '', expectation.url);
    const summary = { ...detail.fixture, expectedPath: join(fixtureDir, 'expected.json'),
      adapterId: expectation.adapterId, sourceDiscoveryId: expectation.sourceDiscoveryId,
      adapterVersion: manifest.version, functionIds: expectation.functionIds };
    return { fixture: summary, passed: stableJson(actual) === stableJson(expectation.results),
      expected: expectation.results, actual };
  }

  async readApprovedAdapterFixture(manifest: AdapterPackageManifest, includeHtml = false):
    Promise<{ fixture: FixtureSummary; html?: string }> {
    const fixture = requireApprovalFixture(manifest);
    const directory = this.approvedFixtureDirectory(manifest.adapterId, manifest.version, fixture.id);
    const detail = await this.readFixtureDirectory(directory, fixture.domain, fixture.id, includeHtml);
    const paths = { path: join(directory, 'page.html'), expectedPath: join(directory, 'expected.json') };
    return { ...detail, fixture: { ...detail.fixture, ...fixture, ...paths,
      adapterId: manifest.adapterId, adapterVersion: manifest.version } };
  }

  private approvedFixtureDirectory(adapterId: string, version: string, id: string): string {
    return join(this.workspaceRoot, 'approved-fixtures', sanitizePathSegment(adapterId),
      sanitizePathSegment(version), sanitizePathSegment(id));
  }

  async readFixture(domain: string, id: string, includeHtml = false): Promise<{ fixture: FixtureSummary; html?: string }> {
    const fixtureDir = join(this.workspaceRoot, 'fixtures', sanitizePathSegment(domain), sanitizePathSegment(id));
    return this.readFixtureDirectory(fixtureDir, domain, id, includeHtml);
  }

  private async readFixtureDirectory(fixtureDir: string, domain: string, id: string,
    includeHtml: boolean): Promise<{ fixture: FixtureSummary; html?: string }> {
    const htmlPath = join(fixtureDir, 'page.html');
    const metaPath = join(fixtureDir, 'meta.md');
    const html = await readFile(htmlPath, 'utf-8');
    const meta = parseFixtureMeta(await readFile(metaPath, 'utf-8').catch(() => ''));
    const url = meta.url ?? `https://${domain}/`;
    const target = parseDomReadinessTarget(meta.target);
    const readiness = this.readiness.check({ url, html, target });
    const fixture = { id, domain, url, title: meta.title ?? '', htmlLength: html.length,
      capturedAt: meta.capturedAt ?? '', path: htmlPath, readiness };
    return { fixture, ...(includeHtml ? { html } : {}) };
  }
}

async function writeBrowserFixture(location: FixtureLocation,
  page: { url: string; title: string; html: string }, input: CaptureFixtureInput,
  readiness: ReturnType<DomReadinessChecker['check']>): Promise<void> {
  const meta = ['# Verified Fixture', '', `- id: ${location.id}`, `- url: ${page.url}`,
    `- title: ${page.title}`, `- domain: ${location.domain}`, `- target: ${input.target}`,
    `- htmlLength: ${page.html.length}`, `- capturedAt: ${location.capturedAt}`,
    `- source: challenge-discovery ${input.challengeDiscoveryId}`, ''].join('\n');
  const readinessText = ['# DOM Readiness', '', `- status: ${readiness.status}`,
    `- target: ${readiness.target}`, `- confidence: ${readiness.confidence}`,
    `- recommendedAction: ${readiness.recommendedAction}`, '', '## Reasons', '',
    ...readiness.reasons.map((reason) => `- ${reason}`), ''].join('\n');
  await Promise.all([writeFile(location.htmlPath, normalizeFixtureHtml(page.html), 'utf-8'),
    writeFile(join(location.directory, 'meta.md'), meta, 'utf-8'),
    writeFile(join(location.directory, 'readiness.md'), readinessText, 'utf-8')]);
}

async function writeApprovedFixture(location: FixtureLocation,
  input: CaptureApprovedAdapterFixtureInput, target: DomReadinessTarget,
  expectation: ApprovedFixtureExpectation): Promise<void> {
  const meta = ['# Approved Adapter Fixture', '', `- id: ${location.id}`, `- url: ${input.url}`,
    `- title: ${input.title ?? ''}`, `- domain: ${location.domain}`, `- target: ${target}`,
    `- htmlLength: ${input.html.length}`, `- capturedAt: ${location.capturedAt}`,
    `- adapterId: ${input.adapter.id}`, `- sourceDiscoveryId: ${input.sourceDiscoveryId}`,
    `- adapterVersion: ${input.adapterVersion}`,
    `- functionIds: ${expectation.functionIds.join(',')}`, ''].join('\n');
  await Promise.all([writeFile(location.htmlPath, normalizeFixtureHtml(input.html), 'utf-8'),
    writeFile(join(location.directory, 'expected.json'), `${JSON.stringify(expectation, null, 2)}\n`, 'utf-8'),
    writeFile(join(location.directory, 'meta.md'), meta, 'utf-8')]);
}

function requireApprovalFixture(manifest: AdapterPackageManifest) {
  if (!manifest.approvalFixture) throw new Error(
    `Adapter package ${manifest.adapterId}@${manifest.version} has no approved fixture.`);
  return manifest.approvalFixture;
}

function assertExpectationIdentity(expectation: ApprovedFixtureExpectation,
  manifest: AdapterPackageManifest, adapter: IComicAdapter): void {
  if (expectation.adapterId !== adapter.id) throw new Error(
    `Fixture expects adapter "${expectation.adapterId}", got "${adapter.id}".`);
  if (expectation.adapterVersion !== manifest.version) throw new Error(
    `Fixture expects version "${expectation.adapterVersion}", got "${manifest.version}".`);
}

function validateExpectedUrl(actual: string, expected?: string): void {
  if (expected && !sameDocumentPath(actual, expected)) throw new Error(
    `Verified browser page does not match the expected URL. Browser page: ${actual}`);
}

async function runFixtureFunctions(adapter: IComicAdapter, ids: string[], html: string,
  url: string): Promise<Record<string, unknown>> {
  const document = cheerio.load(html);
  const results: Record<string, unknown> = {};
  for (const id of ids) results[id] = await runFixtureFunction(adapter, id, document, url);
  return results;
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
