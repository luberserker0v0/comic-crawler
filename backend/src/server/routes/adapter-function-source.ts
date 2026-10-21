import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdapterRegistry } from '../../adapter/registry';
import { DynamicSiteAdapter } from '../../adapter/dynamic-site-adapter';
import { PROJECT_ADAPTER_SOURCE } from '../../adapter/runtime-state';
import type {
  AdapterPackageDocument,
  AdapterFunctionCapability,
  AdapterImplementationResponse,
  AdapterImplementationSymbol,
} from '@comiccrawler/shared';
import type { AdapterFunctionId } from './adapter-function-types';

export async function getAdapterImplementation(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  managed?: AdapterPackageDocument
): Promise<AdapterImplementationResponse> {
  if (managed) return catalogImplementation(managed);
  if (adapter instanceof DynamicSiteAdapter) return dynamicImplementation(adapter);
  const relativePath = PROJECT_ADAPTER_SOURCE[adapter.id];
  if (!relativePath) return unavailableImplementation(adapter.id);
  const sourcePath = resolveAllowlistedSourcePath(relativePath);
  if (!existsSync(sourcePath)) return missingSourceImplementation(adapter.id, relativePath);
  const content = await readFile(sourcePath, 'utf-8');
  return { adapterId: adapter.id, sourceType: 'project-source', language: 'typescript',
    filePath: relativePath, content, outline: createSourceOutline(content),
    notes: `Full adapter implementation from ${relativePath}. Function selection highlights a test target; the source is reviewed as one implementation artifact.`,
  };
}

function catalogImplementation(document: AdapterPackageDocument): AdapterImplementationResponse {
  const { manifest, implementationTs } = document;
  return { adapterId: manifest.adapterId, sourceType: 'catalog-package', language: 'typescript',
    filePath: `adapter-catalog/${manifest.adapterId}/${manifest.version}`,
    content: implementationTs, outline: createSourceOutline(implementationTs),
    notes: `Approved Adapter Catalog package ${manifest.version}.` };
}

function dynamicImplementation(adapter: DynamicSiteAdapter): AdapterImplementationResponse {
  const manifest = adapter.getManifest();
  const content = JSON.stringify({ genericImplementation: 'DynamicSiteAdapter',
    adapterId: manifest.adapterId, name: manifest.name, domains: manifest.domains,
    urlPatterns: manifest.urlPatterns, parseMode: adapter.parseMode,
    capabilities: adapter.capabilities, selectors: manifest.selectors }, null, 2);
  return { adapterId: adapter.id, sourceType: 'dynamic', language: 'json', content,
    outline: createDynamicImplementationOutline(adapter),
    notes: 'Dynamic adapters are reviewed as a full selector manifest plus the generic DynamicSiteAdapter runtime.' };
}

function unavailableImplementation(adapterId: string): AdapterImplementationResponse {
  return { adapterId, sourceType: 'summary', language: 'markdown',
    content: `# Adapter implementation\n\nFull source is not allowlisted for adapter "${adapterId}".`,
    outline: [], notes: 'Only project adapter source files registered in the source map are exposed.' };
}

function missingSourceImplementation(adapterId: string, filePath: string): AdapterImplementationResponse {
  return { adapterId, sourceType: 'project-source', language: 'markdown', filePath,
    content: `# Adapter implementation\n\nAllowlisted source file was not found: ${filePath}`,
    outline: [], notes: 'The application may be running from compiled output without source files.' };
}
export function createDynamicImplementationOutline(adapter: DynamicSiteAdapter): AdapterImplementationSymbol[] {
  const capabilities = adapter.capabilities;
  const outline: AdapterImplementationSymbol[] = [
    { id: 'manifest', label: 'Manifest', kind: 'manifest-section', startLine: 1 },
    { id: 'common', label: 'common.urlPatterns', capability: 'common', kind: 'manifest-section' },
  ];
  if (capabilities.verification) {
    outline.push({ id: 'verification', label: 'verification capability', capability: 'verification', kind: 'manifest-section' });
  }
  if (capabilities.metadata) {
    outline.push(...metadataOutline());
  }
  if (capabilities.chapterImages) {
    outline.push({ id: 'extractChapterImageUrls', label: 'extractChapterImageUrls selectors', capability: 'chapterImages', kind: 'manifest-section' });
  }
  return outline;
}

function metadataOutline(): AdapterImplementationSymbol[] {
  return ['metadata', 'extractTitle', 'extractAuthor', 'extractDescription', 'extractCoverUrl',
    'extractTags', 'extractStatus', 'extractChapterList'].map((id) => ({ id,
      label: id === 'metadata' ? 'metadata selectors' : `${id} selector${id === 'extractChapterList' ? 's' : ''}`,
      capability: 'metadata', kind: 'manifest-section' }));
}

export function createSourceOutline(source: string): AdapterImplementationSymbol[] {
  const lines = source.split(/\r?\n/);
  const symbols: AdapterImplementationSymbol[] = [];
  for (const [index, line] of lines.entries()) {
    symbols.push(...outlineSymbolsForLine(lines, index, line));
  }
  return symbols;
}

function outlineSymbolsForLine(lines: string[], index: number, line: string): AdapterImplementationSymbol[] {
  const className = line.match(/\bclass\s+([A-Za-z0-9_]+)/)?.[1];
  if (className) return [{ id: `class:${className}`, label: className, kind: 'class', startLine: index + 1 }];
  const method = line.match(/\b(matchUrl|detectVerificationRequired|describeVerificationHandoff|extractTitle|extractAuthor|extractDescription|extractCoverUrl|extractTags|extractStatus|extractChapterList|extractChapterImageUrls)\s*\(/)?.[1];
  if (method) return [{ id: method, label: `${method}()`, capability: capabilityForFunction(method as AdapterFunctionId),
    kind: 'method', startLine: index + 1, endLine: findBlockEndLine(lines, index) }];
  const helper = line.match(/^function\s+([A-Za-z0-9_]+)\s*\(/)?.[1];
  return helper ? [{ id: `helper:${helper}`, label: `${helper}()`, kind: 'helper',
    startLine: index + 1, endLine: findBlockEndLine(lines, index) }] : [];
}

export function capabilityForFunction(functionId: AdapterFunctionId): AdapterFunctionCapability {
  if (functionId === 'matchUrl') return 'common';
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') return 'verification';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  return 'metadata';
}

export function findBlockEndLine(lines: string[], start: number): number | undefined {
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

export function resolveAllowlistedSourcePath(relativePath: string): string {
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), '..', relativePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}
