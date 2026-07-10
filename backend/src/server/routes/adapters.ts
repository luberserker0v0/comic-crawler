import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  AdapterCapabilityDetailResponse,
  AdapterFunctionDescriptor,
  AdapterFunctionSourceResponse,
  AdapterFunctionTestRequest,
  AdapterFunctionTestResponse,
} from '@comiccrawler/shared';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import { DynamicSiteAdapter } from '../../adapter/dynamic-site-adapter';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { ChallengeDiscoveryJob } from '../../challenge/discovery-types';

const ADAPTER_FUNCTION_TIMEOUT_MS = 30_000;
const BUILTIN_ADAPTER_SOURCE: Record<string, string> = {
  kuronavi: join('backend', 'src', 'adapter', 'sites', 'kuronavi', 'adapter.ts'),
  happymh: join('backend', 'src', 'adapter', 'sites', 'happymh', 'adapter.ts'),
};

type AdapterFunctionId =
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
}

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

  app.get('/api/adapters/:id/functions/:functionId/source', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const { functionId } = request.params as { functionId: AdapterFunctionId };
    if (!isKnownFunction(functionId)) {
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
    if (!isKnownFunction(functionId)) {
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

function isKnownFunction(functionId: string): functionId is AdapterFunctionId {
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

async function testAdapterFunction(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  functionId: AdapterFunctionId,
  url: string,
  options: {
    challengeDiscoveryId?: string;
    challengeDiscoveryService?: ChallengeDiscoveryService;
  } = {}
): Promise<AdapterFunctionTestResponse> {
  const startedAt = Date.now();
  try {
    const verifiedDocument = options.challengeDiscoveryId
      ? await loadVerifiedChallengeDocument(options.challengeDiscoveryService, options.challengeDiscoveryId, url)
      : undefined;
    const resultSummary = await withTimeout(async () => {
      if (functionId === 'matchUrl') {
        return { matched: adapter.matchUrl(url) };
      }
      if (functionId === 'detectVerificationRequired') {
        return detectVerificationRequiredForUrl(adapter, url);
      }
      if (functionId === 'describeVerificationHandoff') {
        const capabilities = getAdapterCapabilities(adapter);
        return {
          supported: capabilities.verification,
          matched: adapter.matchUrl(url),
          flow: await adapter.describeVerificationHandoff?.(),
        };
      }
      if (isMetadataFunction(functionId)) {
        const document = verifiedDocument ?? await loadAdapterDocument(adapter, url);
        if (functionId === 'extractTitle') return { title: await adapter.extractTitle?.(document, url) };
        if (functionId === 'extractAuthor') return { author: await adapter.extractAuthor?.(document, url) };
        if (functionId === 'extractDescription') return { description: await adapter.extractDescription?.(document, url) };
        if (functionId === 'extractCoverUrl') return { coverUrl: await adapter.extractCoverUrl?.(document, url) };
        if (functionId === 'extractTags') return { tags: await adapter.extractTags?.(document, url) };
        if (functionId === 'extractStatus') return { status: await adapter.extractStatus?.(document, url) };
        const chapters = await adapter.extractChapterList?.(document, url) ?? [];
        return {
          chapterCount: chapters.length,
          firstChapters: chapters.slice(0, 5),
        };
      }
      const document = verifiedDocument ?? await loadAdapterDocument(adapter, url);
      const urls = await adapter.extractChapterImageUrls?.(document, url) ?? [];
      return {
        imageUrlCount: urls.length,
        firstImageUrls: urls.slice(0, 5),
      };
    }, ADAPTER_FUNCTION_TIMEOUT_MS);

    if (functionId === 'detectVerificationRequired' && resultSummary.verificationRequired === true) {
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

    return {
      ok: true,
      status: 'passed',
      adapterId: adapter.id,
      functionId,
      durationMs: Date.now() - startedAt,
      resultSummary,
      requiresVerification: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (looksLikeVerificationRequired(message)) {
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
      error: message,
      requiresVerification: false,
    };
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
  url: string
): Promise<unknown> {
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

  const snapshot = await challengeDiscoveryService.readCdpPageSnapshot(challengeDiscoveryId, job.browserCdpUrl);
  if (!sameHostname(snapshot.page.url, url)) {
    throw new Error(`Verified browser page hostname does not match the test URL: ${snapshot.page.url}`);
  }
  return cheerio.load(snapshot.page.html);
}

function createChallengeNotReadyMessage(job: ChallengeDiscoveryJob): string {
  return [
    `Human verification is still required for challenge job ${job.id}.`,
    job.error,
  ].filter(Boolean).join(' ');
}

function sameHostname(left: string, right: string): boolean {
  try {
    return new URL(left).hostname === new URL(right).hostname;
  } catch {
    return false;
  }
}

async function detectVerificationRequiredForUrl(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  urlOrHtml: string
): Promise<Record<string, unknown>> {
  const detect = adapter.detectVerificationRequired?.bind(adapter) ?? ((input: string) => looksLikeVerificationRequired(input));
  if (!/^https?:\/\//i.test(urlOrHtml)) {
    return {
      verificationRequired: await detect(urlOrHtml),
      source: 'input',
    };
  }

  const maybeFetcher = adapter as unknown as { fetchHtml?: (url: string) => Promise<string> };
  if (!maybeFetcher.fetchHtml) {
    return {
      verificationRequired: await detect(urlOrHtml),
      source: 'url-only',
      warning: 'Adapter does not expose the internal HTML fetcher, so only the URL text was inspected.',
    };
  }

  try {
    const html = await maybeFetcher.fetchHtml(urlOrHtml);
    return {
      verificationRequired: await detect(html),
      source: 'fetched-html',
      htmlLength: html.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      verificationRequired: looksLikeVerificationRequired(message),
      source: 'fetch-error',
      error: message,
    };
  }
}
