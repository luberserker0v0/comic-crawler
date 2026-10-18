import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdapterRegistry } from '../../adapter/registry';
import { DynamicSiteAdapter } from '../../adapter/dynamic-site-adapter';
import { PROJECT_ADAPTER_SOURCE } from '../../adapter/runtime-state';
import type {
  AdapterFunctionCapability,
  AdapterImplementationResponse,
  AdapterImplementationSymbol,
} from '@comiccrawler/shared';
import type { AdapterFunctionId } from './adapter-function-types';

export async function getAdapterImplementation(
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

  const relativePath = PROJECT_ADAPTER_SOURCE[adapter.id];
  if (!relativePath) {
    return {
      adapterId: adapter.id,
      sourceType: 'summary',
      language: 'markdown',
      content: `# Adapter implementation\n\nFull source is not allowlisted for adapter "${adapter.id}".`,
      outline: [],
      notes: 'Only project adapter source files registered in the source map are exposed.',
    };
  }

  const sourcePath = resolveAllowlistedSourcePath(relativePath);
  if (!existsSync(sourcePath)) {
    return {
      adapterId: adapter.id,
      sourceType: 'project-source',
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
    sourceType: 'project-source',
    language: 'typescript',
    filePath: relativePath,
    content,
    outline: createSourceOutline(content),
    notes: `Full adapter implementation from ${relativePath}. Function selection highlights a test target; the source is reviewed as one implementation artifact.`,
  };
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

export function createSourceOutline(source: string): AdapterImplementationSymbol[] {
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
