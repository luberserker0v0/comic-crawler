import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  AdapterCapabilityDetailResponse,
  AdapterFunctionDescriptor,
  AdapterFunctionCapability,
  AdapterImplementationResponse,
  AdapterImplementationSymbol,
  AdapterFunctionSourceResponse,
  AdapterFunctionTestRequest,
  AdapterFunctionTestResponse,
  AdapterDomSource,
  DomReadinessReport,
  DomReadinessTarget,
  FixtureSummary,
} from '@comiccrawler/shared';
import { DEFAULTS } from '@comiccrawler/shared';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import { DynamicSiteAdapter } from '../../adapter/dynamic-site-adapter';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { ChallengeDiscoveryJob } from '../../challenge/discovery-types';
import { looksLikeAntiBotChallenge } from '../../crawler/anti-bot';
import { PlaywrightHtmlRenderer } from '../../crawler/html-renderer';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';
import type { FixtureCaptureService } from '../../fixtures/fixture-capture-service';

const STATIC_ADAPTER_FUNCTION_TIMEOUT_MS = 30_000;
const PLAYWRIGHT_ADAPTER_FUNCTION_TIMEOUT_MS = 15 * 60 * 1000;
const BUILTIN_ADAPTER_SOURCE: Record<string, string> = {
  kuronavi: join('backend', 'src', 'adapter', 'sites', 'kuronavi', 'adapter.ts'),
  happymh: join('backend', 'src', 'adapter', 'sites', 'happymh', 'adapter.ts'),
};

export type AdapterFunctionId =
  | 'matchUrl'
  | 'detectVerificationRequired'
  | 'describeVerificationHandoff'
  | 'extractTitle'
  | 'extractAuthor'
  | 'extractDescription'
  | 'extractCoverUrl'
  | 'extractTags'
  | 'extractStatus'
  | 'extractChapterList'
  | 'extractChapterImageUrls';

interface AdapterRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
  fixtureCaptureService?: FixtureCaptureService;
}

interface VerifiedChallengeDocument {
  document: cheerio.CheerioAPI;
  page: { url: string; title: string; html: string };
  fixture?: FixtureSummary;
}

type AdapterCrawlerMode = 'static' | 'playwright';

export function setupAdaptersRoutes(app: FastifyInstance, registry: AdapterRegistry, options: AdapterRouteOptions = {}): void {
  app.get('/api/adapters', async (_request: FastifyRequest, reply: FastifyReply) => {
    const adapters = registry.list();
    reply.send({ data: adapters });
  });

  app.post('/api/adapters/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { url?: string; mode?: 'all' | 'chapters' };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required' });
        return;
      }
      const mode = body.mode ?? 'all';
      if (mode !== 'all' && mode !== 'chapters') {
        reply.code(400).send({ error: 'Mode must be "all" or "chapters"' });
        return;
      }

      const parsed = new URL(body.url);
      const requiredCapabilities = mode === 'chapters'
        ? { chapterImages: true }
        : { metadata: true, chapterImages: true };
      const matchedAdapter = registry.findByUrlWithCapabilities(parsed.href, requiredCapabilities);
      const anyMatchedAdapter = registry.findByUrl(parsed.href);

      reply.send({
        data: {
          url: parsed.href,
          hostname: parsed.hostname,
          mode,
          requiredCapabilities,
          status: matchedAdapter
            ? 'matched'
            : anyMatchedAdapter
              ? 'capability_mismatch'
              : 'not_found',
          adapter: matchedAdapter ? describeAdapter(matchedAdapter) : undefined,
          matchedAdapter: anyMatchedAdapter ? describeAdapter(anyMatchedAdapter) : undefined,
          discoveryTarget: mode === 'chapters' ? 'chapter-only' : 'full',
        },
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/adapters/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const adapter = registry.get(id);

    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    reply.send({
      data: {
        id: adapter.id,
        name: adapter.name,
        domains: adapter.domains,
        parseMode: adapter.parseMode,
        supportsLogin: !!adapter.login,
        supportsSearch: !!adapter.search,
        capabilities: getAdapterCapabilities(adapter),
      },
    });
  });

  app.get('/api/adapters/:id/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const data: AdapterCapabilityDetailResponse = {
      adapter: describeAdapter(adapter),
      functions: describeAdapterFunctions(adapter),
    };
    reply.send({ data });
  });

  app.get('/api/adapters/:id/implementation', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const data = await getAdapterImplementation(adapter);
    reply.send({ data });
  });

  app.get('/api/adapters/:id/functions/:functionId/source', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const { functionId } = request.params as { functionId: AdapterFunctionId };
    if (!isKnownAdapterFunction(functionId)) {
      reply.code(400).send({ error: 'Unknown adapter function.' });
      return;
    }

    const source = await getAdapterFunctionSource(adapter, functionId);
    reply.send({ data: source });
  });

  app.post('/api/adapters/:id/functions/:functionId/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const { functionId } = request.params as { functionId: AdapterFunctionId };
    if (!isKnownAdapterFunction(functionId)) {
      reply.code(400).send({ error: 'Unknown adapter function.' });
      return;
    }

    const body = request.body as AdapterFunctionTestRequest;
    if (!body.url) {
      reply.code(400).send({ error: 'URL is required' });
      return;
    }

      const result = await testAdapterFunction(adapter, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        fixtureCaptureService: options.fixtureCaptureService,
      });
    reply.send({ data: result });
  });

  app.post('/api/adapters/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id: string; name: string; domains: string[] };

    if (!body.id || !body.name || !body.domains) {
      reply.code(400).send({ error: 'id, name, and domains are required' });
      return;
    }

    reply.send({ data: { message: 'Adapter registration endpoint' } });
  });
}

function describeAdapter(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>) {
  return {
    id: adapter.id,
    name: adapter.name,
    domains: adapter.domains,
    parseMode: adapter.parseMode,
    capabilities: getAdapterCapabilities(adapter),
  };
}

function getAdapterFromRequest(request: FastifyRequest, registry: AdapterRegistry): NonNullable<ReturnType<AdapterRegistry['get']>> | undefined {
  const { id } = request.params as { id: string };
  return registry.get(id);
}

function describeAdapterFunctions(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>): AdapterFunctionDescriptor[] {
  const capabilities = getAdapterCapabilities(adapter);
  return [
    {
      id: 'matchUrl',
      label: 'matchUrl(url)',
      capability: 'common',
      implemented: true,
      inputKind: 'url',
      notes: 'Checks whether this adapter accepts the provided URL.',
    },
    {
      id: 'detectVerificationRequired',
      label: 'detectVerificationRequired(urlOrHtml)',
      capability: 'verification',
      implemented: capabilities.verification,
      inputKind: 'url',
      notes: 'Detects whether the provided URL or HTML text appears to require human verification.',
    },
    {
      id: 'describeVerificationHandoff',
      label: 'describeVerificationHandoff()',
      capability: 'verification',
      implemented: capabilities.verification,
      inputKind: 'url',
      notes: 'Describes the pipeline-level human verification handoff flow.',
    },
    {
      id: 'extractTitle',
      label: 'extractTitle(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga title from a parsed manga catalog document.',
    },
    {
      id: 'extractAuthor',
      label: 'extractAuthor(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga author from a parsed manga catalog document.',
    },
    {
      id: 'extractDescription',
      label: 'extractDescription(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga description from a parsed manga catalog document.',
    },
    {
      id: 'extractCoverUrl',
      label: 'extractCoverUrl(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the cover URL from a parsed manga catalog document.',
    },
    {
      id: 'extractTags',
      label: 'extractTags(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only tag/category labels from a parsed manga catalog document.',
    },
    {
      id: 'extractStatus',
      label: 'extractStatus(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only completion/ongoing status from a parsed manga catalog document.',
    },
    {
      id: 'extractChapterList',
      label: 'extractChapterList(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the chapter list from a parsed manga catalog document.',
    },
    {
      id: 'extractChapterImageUrls',
      label: 'extractChapterImageUrls(document)',
      capability: 'chapterImages',
      implemented: capabilities.chapterImages,
      inputKind: 'chapterUrl',
      notes: 'Extracts only raw chapter image URLs from a parsed chapter reader document.',
    },
  ];
}

export function isKnownAdapterFunction(functionId: string): functionId is AdapterFunctionId {
  return [
    'matchUrl',
    'detectVerificationRequired',
    'describeVerificationHandoff',
    'extractTitle',
    'extractAuthor',
    'extractDescription',
    'extractCoverUrl',
    'extractTags',
    'extractStatus',
    'extractChapterList',
    'extractChapterImageUrls',
  ].includes(functionId);
}

async function getAdapterImplementation(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>
): Promise<AdapterImplementationResponse> {
  if (adapter instanceof DynamicSiteAdapter) {
    const manifest = adapter.getManifest();
    const content = JSON.stringify({
      genericImplementation: 'DynamicSiteAdapter',
      adapterId: manifest.adapterId,
      name: manifest.name,
      domains: manifest.domains,
      urlPatterns: manifest.urlPatterns,
      parseMode: adapter.parseMode,
      capabilities: adapter.capabilities,
      selectors: manifest.selectors,
    }, null, 2);
    return {
      adapterId: adapter.id,
      sourceType: 'dynamic',
      language: 'json',
      content,
      outline: createDynamicImplementationOutline(adapter),
      notes: 'Dynamic adapters are reviewed as a full selector manifest plus the generic DynamicSiteAdapter runtime.',
    };
  }

  const relativePath = BUILTIN_ADAPTER_SOURCE[adapter.id];
  if (!relativePath) {
    return {
      adapterId: adapter.id,
      sourceType: 'summary',
      language: 'markdown',
      content: `# Adapter implementation\n\nFull source is not allowlisted for adapter "${adapter.id}".`,
      outline: [],
      notes: 'Only known built-in adapter source files are exposed.',
    };
  }

  const sourcePath = resolveAllowlistedSourcePath(relativePath);
  if (!existsSync(sourcePath)) {
    return {
      adapterId: adapter.id,
      sourceType: 'built-in',
      language: 'markdown',
      filePath: relativePath,
      content: `# Adapter implementation\n\nAllowlisted source file was not found: ${relativePath}`,
      outline: [],
      notes: 'The application may be running from compiled output without source files.',
    };
  }

  const content = await readFile(sourcePath, 'utf-8');
  return {
    adapterId: adapter.id,
    sourceType: 'built-in',
    language: 'typescript',
    filePath: relativePath,
    content,
    outline: createSourceOutline(content),
    notes: `Full adapter implementation from ${relativePath}. Function selection highlights a test target; the source is reviewed as one implementation artifact.`,
  };
}

function createDynamicImplementationOutline(adapter: DynamicSiteAdapter): AdapterImplementationSymbol[] {
  const capabilities = adapter.capabilities;
  const outline: AdapterImplementationSymbol[] = [
    { id: 'manifest', label: 'Manifest', kind: 'manifest-section', startLine: 1 },
    { id: 'common', label: 'common.urlPatterns', capability: 'common', kind: 'manifest-section' },
  ];
  if (capabilities.verification) {
    outline.push({ id: 'verification', label: 'verification capability', capability: 'verification', kind: 'manifest-section' });
  }
  if (capabilities.metadata) {
    outline.push({ id: 'metadata', label: 'metadata selectors', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractTitle', label: 'extractTitle selector', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractAuthor', label: 'extractAuthor selector', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractDescription', label: 'extractDescription selector', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractCoverUrl', label: 'extractCoverUrl selector', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractTags', label: 'extractTags selector', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractStatus', label: 'extractStatus selector', capability: 'metadata', kind: 'manifest-section' });
    outline.push({ id: 'extractChapterList', label: 'extractChapterList selectors', capability: 'metadata', kind: 'manifest-section' });
  }
  if (capabilities.chapterImages) {
    outline.push({ id: 'extractChapterImageUrls', label: 'extractChapterImageUrls selectors', capability: 'chapterImages', kind: 'manifest-section' });
  }
  return outline;
}

function createSourceOutline(source: string): AdapterImplementationSymbol[] {
  const lines = source.split(/\r?\n/);
  const symbols: AdapterImplementationSymbol[] = [];
  for (const [index, line] of lines.entries()) {
    const classMatch = line.match(/\bclass\s+([A-Za-z0-9_]+)/);
    if (classMatch?.[1]) {
      symbols.push({
        id: `class:${classMatch[1]}`,
        label: classMatch[1],
        kind: 'class',
        startLine: index + 1,
      });
    }

    const methodMatch = line.match(/\b(matchUrl|detectVerificationRequired|describeVerificationHandoff|extractTitle|extractAuthor|extractDescription|extractCoverUrl|extractTags|extractStatus|extractChapterList|extractChapterImageUrls)\s*\(/);
    if (methodMatch?.[1]) {
      symbols.push({
        id: methodMatch[1],
        label: `${methodMatch[1]}()`,
        capability: capabilityForFunction(methodMatch[1] as AdapterFunctionId),
        kind: 'method',
        startLine: index + 1,
        endLine: findBlockEndLine(lines, index),
      });
      continue;
    }

    const helperMatch = line.match(/^function\s+([A-Za-z0-9_]+)\s*\(/);
    if (helperMatch?.[1]) {
      symbols.push({
        id: `helper:${helperMatch[1]}`,
        label: `${helperMatch[1]}()`,
        kind: 'helper',
        startLine: index + 1,
        endLine: findBlockEndLine(lines, index),
      });
    }
  }
  return symbols;
}

function capabilityForFunction(functionId: AdapterFunctionId): AdapterFunctionCapability {
  if (functionId === 'matchUrl') return 'common';
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') return 'verification';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  return 'metadata';
}

function findBlockEndLine(lines: string[], start: number): number | undefined {
  let depth = 0;
  let started = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const char of line) {
      if (char === '{') {
        depth += 1;
        started = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    if (started && depth <= 0) return index + 1;
  }
  return undefined;
}

async function getAdapterFunctionSource(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  functionId: AdapterFunctionId
): Promise<AdapterFunctionSourceResponse> {
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') {
    return {
      adapterId: adapter.id,
      functionId,
      language: 'markdown',
      sourceKind: 'pipeline-summary',
      source: [
        '# Verification capability',
        '',
        '- detectVerificationRequired(input): detects anti-bot or human-verification signals.',
        '- describeVerificationHandoff(): describes the official task-detail browser handoff.',
        '',
        'The browser handoff itself is implemented by the crawler/task pipeline. Adapter Lab can create the same handoff job for diagnosis, then retry the selected fine-grained function against the verified browser page.',
      ].join('\n'),
      notes: 'Adapter Lab uses the official verification handoff service when a test URL is blocked.',
    };
  }

  if (adapter instanceof DynamicSiteAdapter) {
    const manifest = adapter.getManifest();
    return {
      adapterId: adapter.id,
      functionId,
      language: 'json',
      sourceKind: 'dynamic-manifest',
      source: JSON.stringify({
        genericImplementation: 'DynamicSiteAdapter',
        functionId,
        capabilities: manifest.capabilities,
        domains: manifest.domains,
        urlPatterns: manifest.urlPatterns,
        selectors: manifest.selectors,
      }, null, 2),
      notes: 'Dynamic adapters use the generic DynamicSiteAdapter implementation plus this selector manifest.',
    };
  }

  const relativePath = BUILTIN_ADAPTER_SOURCE[adapter.id];
  if (!relativePath) {
    return {
      adapterId: adapter.id,
      functionId,
      language: 'markdown',
      sourceKind: 'builtin-source',
      source: `Source snippet is not allowlisted for adapter "${adapter.id}".`,
      notes: 'Only known built-in adapter source files are exposed.',
    };
  }

  const sourcePath = resolveAllowlistedSourcePath(relativePath);
  if (!existsSync(sourcePath)) {
    return {
      adapterId: adapter.id,
      functionId,
      language: 'markdown',
      sourceKind: 'builtin-source',
      source: `Allowlisted source file was not found: ${relativePath}`,
      notes: 'The application may be running from compiled output without source files.',
    };
  }

  const source = await readFile(sourcePath, 'utf-8');
  return {
    adapterId: adapter.id,
    functionId,
    language: 'typescript',
    sourceKind: 'builtin-source',
    source: extractFunctionSnippet(source, functionId),
    notes: `Source snippet from ${relativePath}.`,
  };
}

function resolveAllowlistedSourcePath(relativePath: string): string {
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), '..', relativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function extractFunctionSnippet(source: string, functionId: AdapterFunctionId): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    if (functionId === 'matchUrl') return /\bmatchUrl\s*\(/.test(line);
    if (functionId === 'detectVerificationRequired') return /\bdetectVerificationRequired\s*\(/.test(line);
    if (functionId === 'describeVerificationHandoff') return /\bdescribeVerificationHandoff\s*\(/.test(line);
    if (functionId === 'extractTitle') return /\bextractTitle\s*\(/.test(line);
    if (functionId === 'extractAuthor') return /\bextractAuthor\s*\(/.test(line);
    if (functionId === 'extractDescription') return /\bextractDescription\s*\(/.test(line);
    if (functionId === 'extractCoverUrl') return /\bextractCoverUrl\s*\(/.test(line);
    if (functionId === 'extractTags') return /\bextractTags\s*\(/.test(line);
    if (functionId === 'extractStatus') return /\bextractStatus\s*\(/.test(line);
    if (functionId === 'extractChapterList') return /\bextractChapterList\s*\(/.test(line);
    if (functionId === 'extractChapterImageUrls') return /\bextractChapterImageUrls\s*\(/.test(line);
    return false;
  });
  if (start < 0) return `Function "${functionId}" was not found in the allowlisted source file.`;

  const snippet: string[] = [];
  let depth = 0;
  let started = false;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    snippet.push(line);
    for (const char of line) {
      if (char === '{') {
        depth += 1;
        started = true;
      } else if (char === '}') {
        depth -= 1;
      }
    }
    if (started && depth <= 0) break;
  }
  return snippet.join('\n');
}

export async function testAdapterFunction(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  functionId: AdapterFunctionId,
  url: string,
  options: {
    challengeDiscoveryId?: string;
    challengeDiscoveryService?: ChallengeDiscoveryService;
    fixtureCaptureService?: FixtureCaptureService;
  } = {}
): Promise<AdapterFunctionTestResponse> {
  const startedAt = Date.now();
  const crawlerMode = defaultCrawlerModeForAdapter(adapter);
  const target = readinessTargetForFunction(functionId);
  const domSource = domSourceForCrawlerMode(crawlerMode);
  const renderer = crawlerMode === 'playwright'
    ? new PlaywrightHtmlRenderer({
        ...DEFAULTS.browser,
        mode: 'headless',
        challengeAutoAttempt: false,
        challengeWaitMs: 0,
      })
      : undefined;
  try {
    if (renderer && typeof (adapter as unknown as { setHtmlRenderer?: (renderer: unknown) => void }).setHtmlRenderer === 'function') {
      (adapter as unknown as { setHtmlRenderer: (renderer: unknown) => void }).setHtmlRenderer(renderer);
    }
    const verifiedDocument = options.challengeDiscoveryId
      ? await loadVerifiedChallengeDocument(options.challengeDiscoveryService, options.challengeDiscoveryId, url, {
        settle: functionId === 'extractChapterImageUrls',
        expandCatalog: functionId === 'extractChapterList',
        allowNavigate: false,
        functionId,
        target,
        fixtureCaptureService: options.fixtureCaptureService,
      })
      : undefined;
    const resultSummary = await withTimeout(() => runWithCrawlerMode(adapter, crawlerMode, async () => {
      if (functionId === 'matchUrl') {
        return { matched: adapter.matchUrl(url), domSource };
      }
      if (functionId === 'detectVerificationRequired') {
        if (verifiedDocument) {
          const html = verifiedDocument.page.html;
          return {
            verificationRequired: looksLikeAntiBotChallenge(html),
            source: 'verified-browser-html',
            htmlLength: html.length,
            domSource: 'verified-fixture',
            ...verifiedDocumentSourceSummary(verifiedDocument),
          };
        }
        return detectVerificationRequiredForUrl(adapter, url, crawlerMode);
      }
      if (functionId === 'describeVerificationHandoff') {
        const capabilities = getAdapterCapabilities(adapter);
        return {
          supported: capabilities.verification,
          matched: adapter.matchUrl(url),
          flow: await adapter.describeVerificationHandoff?.(),
          domSource,
        };
      }
      if (isMetadataFunction(functionId)) {
        const document = verifiedDocument?.document ?? await loadAdapterDocument(adapter, url);
        const sourceSummary = verifiedDocument ? verifiedDocumentSourceSummary(verifiedDocument) : {};
        if (functionId === 'extractTitle') return { title: await adapter.extractTitle?.(document, url), ...sourceSummary };
        if (functionId === 'extractAuthor') return { author: await adapter.extractAuthor?.(document, url), ...sourceSummary };
        if (functionId === 'extractDescription') return { description: await adapter.extractDescription?.(document, url), ...sourceSummary };
        if (functionId === 'extractCoverUrl') return { coverUrl: await adapter.extractCoverUrl?.(document, url), ...sourceSummary };
        if (functionId === 'extractTags') return { tags: await adapter.extractTags?.(document, url), ...sourceSummary };
        if (functionId === 'extractStatus') return { status: await adapter.extractStatus?.(document, url), ...sourceSummary };
        const chapters = await adapter.extractChapterList?.(document, url) ?? [];
        return {
          chapterCount: chapters.length,
          chapters,
          ...sourceSummary,
        };
      }
      const document = verifiedDocument?.document ?? await loadAdapterDocument(adapter, url);
      const urls = await adapter.extractChapterImageUrls?.(document, url) ?? [];
      return {
        imageUrlCount: urls.length,
        firstImageUrls: urls.slice(0, 5),
        ...(verifiedDocument ? verifiedDocumentSourceSummary(verifiedDocument) : {}),
      };
    }), adapterFunctionTimeoutMs(crawlerMode));

    if (crawlerMode === 'playwright' && functionId === 'detectVerificationRequired' && resultSummary.verificationRequired === true) {
      return createVerificationRequiredResponse({
        adapterId: adapter.id,
        functionId,
        durationMs: Date.now() - startedAt,
        url,
        error: typeof resultSummary.error === 'string' ? resultSummary.error : 'The page requires human verification.',
        challengeDiscoveryService: options.challengeDiscoveryService,
        existingChallengeDiscoveryId: options.challengeDiscoveryId,
      });
    }

    const readiness = combineReadiness(
      verifiedDocument?.fixture?.readiness,
      readinessForResult({
        target,
        functionId,
        resultSummary,
      })
    );
    if (readiness.status !== 'ready') {
      return {
        ok: false,
        status: 'failed',
        adapterId: adapter.id,
        functionId,
        durationMs: Date.now() - startedAt,
        domSource: verifiedDocument ? 'verified-fixture' : domSource,
        readiness,
        recommendedAction: readiness.recommendedAction,
        fixtureId: verifiedDocument?.fixture?.id,
        fixturePath: verifiedDocument?.fixture?.path,
        resultSummary,
        error: `DOM readiness is not trusted enough for this function: ${readiness.reasons.join(' ')}`,
        requiresVerification: false,
      };
    }

    return {
      ok: true,
      status: 'passed',
      adapterId: adapter.id,
      functionId,
      durationMs: Date.now() - startedAt,
      domSource: verifiedDocument ? 'verified-fixture' : domSource,
      readiness,
      recommendedAction: readiness.recommendedAction,
      fixtureId: verifiedDocument?.fixture?.id,
      fixturePath: verifiedDocument?.fixture?.path,
      resultSummary,
      requiresVerification: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (crawlerMode === 'playwright' && shouldOfferHandoffForPlaywrightTest(message)) {
      return createVerificationRequiredResponse({
        adapterId: adapter.id,
        functionId,
        durationMs: Date.now() - startedAt,
        url,
        error: message,
        challengeDiscoveryService: options.challengeDiscoveryService,
        existingChallengeDiscoveryId: options.challengeDiscoveryId,
      });
    }
    return {
      ok: false,
      status: 'failed',
      adapterId: adapter.id,
      functionId,
      durationMs: Date.now() - startedAt,
      domSource,
      readiness: failureReadiness(target, message),
      recommendedAction: looksLikeVerificationRequired(message) ? 'human_verification_handoff' : 'manual_review',
      error: message,
      requiresVerification: false,
    };
  } finally {
    if (renderer && typeof (adapter as unknown as { setHtmlRenderer?: (renderer: undefined) => void }).setHtmlRenderer === 'function') {
      (adapter as unknown as { setHtmlRenderer: (renderer: undefined) => void }).setHtmlRenderer(undefined);
    }
    await renderer?.dispose().catch(() => undefined);
  }
}

async function createVerificationRequiredResponse(input: {
  adapterId: string;
  functionId: AdapterFunctionId;
  durationMs: number;
  url: string;
  error: string;
  challengeDiscoveryService?: ChallengeDiscoveryService;
  existingChallengeDiscoveryId?: string;
}): Promise<AdapterFunctionTestResponse> {
  const job = input.existingChallengeDiscoveryId
    ? await input.challengeDiscoveryService?.get(input.existingChallengeDiscoveryId)
    : await input.challengeDiscoveryService?.createDeferred({ url: input.url });

  return {
    ok: false,
    status: 'verification_required',
    adapterId: input.adapterId,
    functionId: input.functionId,
    durationMs: input.durationMs,
    domSource: 'handoff-required',
    readiness: {
      status: 'human_verification_required',
      target: readinessTargetForFunction(input.functionId),
      confidence: 0,
      reasons: [input.error],
      recommendedAction: 'human_verification_handoff',
    },
    recommendedAction: 'human_verification_handoff',
    error: input.error,
    requiresVerification: true,
    challengeDiscoveryId: job?.id ?? input.existingChallengeDiscoveryId,
    retryableAfterVerification: Boolean(job?.id ?? input.existingChallengeDiscoveryId),
    verificationMessage: job
      ? 'Human verification is required. Open the verification browser, complete the check, then continue this adapter function test.'
      : 'Human verification is required, but the handoff service is not available in this backend instance.',
  };
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Adapter function test timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function looksLikeVerificationRequired(message: string): boolean {
  return /anti-bot|human verification|challenge|cloudflare|sorry, you have been blocked|unable to access|人机验证|人機驗證|HTTP\s+(?:401|403|429|503)\b/i.test(message);
}

function shouldOfferHandoffForPlaywrightTest(message: string): boolean {
  return looksLikeVerificationRequired(message)
    || /(?:page\.goto|navigation|render|adapter function test).*timed out|timeout\s+\d+ms exceeded/i.test(message);
}

function isMetadataFunction(functionId: AdapterFunctionId): boolean {
  return [
    'extractTitle',
    'extractAuthor',
    'extractDescription',
    'extractCoverUrl',
    'extractTags',
    'extractStatus',
    'extractChapterList',
  ].includes(functionId);
}

function defaultCrawlerModeForAdapter(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>): AdapterCrawlerMode {
  return adapter.parseMode === 'dynamic' || adapter.parseMode === 'interactive'
    ? 'playwright'
    : 'static';
}

function adapterFunctionTimeoutMs(crawlerMode: AdapterCrawlerMode): number {
  return crawlerMode === 'playwright'
    ? PLAYWRIGHT_ADAPTER_FUNCTION_TIMEOUT_MS
    : STATIC_ADAPTER_FUNCTION_TIMEOUT_MS;
}

async function runWithCrawlerMode<T>(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  crawlerMode: AdapterCrawlerMode,
  operation: () => Promise<T>
): Promise<T> {
  const mode = crawlerMode === 'playwright' ? 'headless' : 'static';
  const maybeScopedAdapter = adapter as unknown as {
    withHtmlFetchMode?: <TResult>(mode: 'static' | 'headless', fn: () => Promise<TResult>) => Promise<TResult>;
  };
  if (maybeScopedAdapter.withHtmlFetchMode) {
    return maybeScopedAdapter.withHtmlFetchMode(mode, operation);
  }
  return operation();
}

async function loadAdapterDocument(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>, url: string): Promise<unknown> {
  const maybeDocumentLoader = adapter as unknown as { loadDocument?: (url: string) => Promise<unknown> };
  if (!maybeDocumentLoader.loadDocument) {
    throw new Error(`Adapter "${adapter.id}" does not expose the internal document loader required for fine-grained function tests.`);
  }
  return maybeDocumentLoader.loadDocument(url);
}

async function loadVerifiedChallengeDocument(
  challengeDiscoveryService: ChallengeDiscoveryService | undefined,
  challengeDiscoveryId: string,
  url: string,
  options: {
    settle?: boolean;
    expandCatalog?: boolean;
    allowNavigate?: boolean;
    functionId?: AdapterFunctionId;
    target?: DomReadinessTarget;
    fixtureCaptureService?: FixtureCaptureService;
  } = {}
): Promise<VerifiedChallengeDocument> {
  if (!challengeDiscoveryService) {
    throw new Error('Human verification is required, but the handoff service is not available.');
  }

  const job = await challengeDiscoveryService.get(challengeDiscoveryId);
  if (!job) {
    throw new Error(`Challenge discovery job "${challengeDiscoveryId}" was not found.`);
  }
  if (job.status !== 'ready') {
    throw new Error(createChallengeNotReadyMessage(job));
  }

  const snapshot = await challengeDiscoveryService.readCdpPageSnapshot(challengeDiscoveryId, job.browserCdpUrl, {
    settle: options.settle,
    expandCatalog: options.expandCatalog,
    allowNavigate: options.allowNavigate,
  });
  if (!sameDocumentPath(snapshot.page.url, url)) {
    throw new Error(`Verified browser page does not match the test URL. Browser page: ${snapshot.page.url}`);
  }
  const fixture = options.functionId && options.target && options.fixtureCaptureService
    ? await options.fixtureCaptureService.captureBrowserDocument({
      challengeDiscoveryId,
      target: options.target,
      functionId: options.functionId,
      expectedUrl: url,
      settle: options.settle,
      expandCatalog: options.expandCatalog,
      allowNavigate: options.allowNavigate,
    })
    : undefined;
  return {
    document: cheerio.load(snapshot.page.html),
    page: snapshot.page,
    fixture,
  };
}

function createChallengeNotReadyMessage(job: ChallengeDiscoveryJob): string {
  return [
    `Human verification is still required for challenge job ${job.id}.`,
    job.error,
  ].filter(Boolean).join(' ');
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

function verifiedDocumentSourceSummary(verifiedDocument: VerifiedChallengeDocument): Record<string, unknown> {
  return {
    sourcePageUrl: verifiedDocument.page.url,
    sourcePageTitle: verifiedDocument.page.title,
    sourceHtmlLength: verifiedDocument.page.html.length,
    ...(verifiedDocument.fixture ? {
      sourceFixtureId: verifiedDocument.fixture.id,
      sourceFixturePath: verifiedDocument.fixture.path,
    } : {}),
  };
}

async function detectVerificationRequiredForUrl(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  urlOrHtml: string,
  crawlerMode: AdapterCrawlerMode
): Promise<Record<string, unknown>> {
  const detect = adapter.detectVerificationRequired?.bind(adapter) ?? ((input: string) => looksLikeVerificationRequired(input));
  if (!/^https?:\/\//i.test(urlOrHtml)) {
    return {
      verificationRequired: await detect(urlOrHtml),
      source: 'input',
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  }

  const maybeFetcher = adapter as unknown as { fetchHtml?: (url: string) => Promise<string> };
  if (!maybeFetcher.fetchHtml) {
    return {
      verificationRequired: await detect(urlOrHtml),
      source: 'url-only',
      warning: 'Adapter does not expose the internal HTML fetcher, so only the URL text was inspected.',
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  }

  try {
    const html = await maybeFetcher.fetchHtml(urlOrHtml);
    return {
      verificationRequired: looksLikeAntiBotChallenge(html),
      source: 'fetched-html',
      htmlLength: html.length,
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verificationRequired: looksLikeVerificationRequired(message),
      source: 'fetch-error',
      error: message,
      domSource: domSourceForCrawlerMode(crawlerMode),
    };
  }
}

function domSourceForCrawlerMode(crawlerMode: AdapterCrawlerMode): AdapterDomSource {
  return crawlerMode === 'playwright' ? 'rendered' : 'static';
}

function readinessTargetForFunction(functionId: AdapterFunctionId): DomReadinessTarget {
  if (isMetadataFunction(functionId)) return 'metadata';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') return 'verification';
  return 'common';
}

function readinessForResult(input: {
  target: DomReadinessTarget;
  functionId: AdapterFunctionId;
  resultSummary: Record<string, unknown>;
}): DomReadinessReport {
  if (input.target === 'common' || input.target === 'verification') {
    return {
      status: 'ready',
      target: input.target,
      confidence: 0.9,
      reasons: ['Function does not require DOM extraction readiness.'],
      recommendedAction: 'continue',
    };
  }
  const empty = isEmptyResultForFunction(input.functionId, input.resultSummary);
  return {
    status: empty ? 'needs_fixture_or_manual_review' : 'ready',
    target: input.target,
    confidence: empty ? 0.35 : 0.8,
    reasons: empty
      ? ['Extraction returned an empty or low-signal result.']
      : ['Extraction returned a non-empty result.'],
    recommendedAction: empty ? 'capture_verified_fixture' : 'continue',
  };
}

function combineReadiness(
  domReadiness: DomReadinessReport | undefined,
  resultReadiness: DomReadinessReport
): DomReadinessReport {
  if (!domReadiness) return resultReadiness;
  if (domReadiness.status === 'ready' && resultReadiness.status === 'ready') {
    return {
      ...domReadiness,
      confidence: Math.min(domReadiness.confidence, resultReadiness.confidence),
      reasons: [...domReadiness.reasons, ...resultReadiness.reasons],
    };
  }
  if (domReadiness.status !== 'ready') return domReadiness;
  return {
    ...resultReadiness,
    reasons: [...domReadiness.reasons, ...resultReadiness.reasons],
  };
}

function failureReadiness(target: DomReadinessTarget, message: string): DomReadinessReport {
  return {
    status: looksLikeVerificationRequired(message) ? 'human_verification_required' : 'failed',
    target,
    confidence: 0,
    reasons: [message],
    recommendedAction: looksLikeVerificationRequired(message) ? 'human_verification_handoff' : 'manual_review',
  };
}

function isEmptyResultForFunction(functionId: AdapterFunctionId, result: Record<string, unknown>): boolean {
  const keyByFunction: Partial<Record<AdapterFunctionId, string>> = {
    extractTitle: 'title',
    extractAuthor: 'author',
    extractDescription: 'description',
    extractCoverUrl: 'coverUrl',
    extractTags: 'tags',
    extractStatus: 'status',
    extractChapterList: 'chapterCount',
    extractChapterImageUrls: 'imageUrlCount',
  };
  const key = keyByFunction[functionId];
  if (!key) return false;
  const value = result[key];
  if (typeof value === 'number') return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return value === undefined || value === null;
}
