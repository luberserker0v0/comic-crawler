import type { AdapterImplementationSymbol } from '@comiccrawler/shared';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import { instantiateAdapterImplementationDraft } from '../../selector-discovery/adapter-draft-runtime';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { resolveRuntimeConfig } from '../../config/runtime';

export async function instantiateDiscoveryDraftAdapter(discoveryService: SelectorDiscoveryService, id: string) {
  const job = await discoveryService.get(id);
  if (!job) {
    throw new Error('Discovery job not found.');
  }
  if (!job.adapterImplementationTs?.trim()) {
    throw new Error('Discovery job has no adapter implementation draft.');
  }
  if (job.implementationValidation && !job.implementationValidation.valid) {
    throw new Error(`Adapter implementation draft is invalid: ${job.implementationValidation.errors.join('; ') || 'unknown error'}`);
  }
  return instantiateAdapterImplementationDraft(job.adapterImplementationTs);
}

export function createImplementationOutline(source: string): AdapterImplementationSymbol[] {
  const lines = source.split(/\r?\n/);
  const symbols: AdapterImplementationSymbol[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const classMatch = /\b(?:export\s+)?class\s+(\w+)\s+extends\s+(\w+)/.exec(line);
    if (classMatch?.[1]) {
      symbols.push({
        id: classMatch[1],
        label: classMatch[1],
        kind: 'class',
        startLine: index + 1,
        capability: capabilityFromBaseClass(classMatch[2]),
      });
      continue;
    }
    const methodMatch = /^\s*(?:public\s+|protected\s+|private\s+)?(?:override\s+)?(?:async\s+)?(matchUrl|detectVerificationRequired|describeVerificationHandoff|extractTitle|extractAuthor|extractDescription|extractCoverUrl|extractTags|extractStatus|extractChapterList|extractChapterImageUrls)\s*\(/.exec(line);
    if (methodMatch?.[1]) {
      symbols.push({
        id: methodMatch[1],
        label: methodMatch[1],
        kind: 'method',
        startLine: index + 1,
        capability: capabilityFromFunction(methodMatch[1]),
      });
    }
  }
  return symbols;
}

export function capabilityFromBaseClass(baseClass?: string): AdapterImplementationSymbol['capability'] {
  if (baseClass === 'CommonCapability') return 'common';
  if (baseClass === 'VerificationCapability') return 'verification';
  if (baseClass === 'MetadataCapability') return 'metadata';
  if (baseClass === 'ChapterImagesCapability') return 'chapterImages';
  return undefined;
}

export function capabilityFromFunction(functionId: string): AdapterImplementationSymbol['capability'] {
  if (functionId === 'matchUrl') return 'common';
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') return 'verification';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  return 'metadata';
}

export async function listBundleEvaluations(): Promise<Array<{
  hash: string;
  passed: boolean;
  createdAt?: string;
  model?: string;
  aoBaseUrl?: string;
  jobId?: string;
  url?: string;
  reasons: string[];
  path: string;
}>> {
  const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
  const evaluationsRoot = join(workspaceRoot, 'bundle-evaluations');
  const entries = await fs.readdir(evaluationsRoot, { withFileTypes: true }).catch(() => []);
  const evaluations = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/i.test(entry.name))
    .map(async (entry) => {
      const directory = join(evaluationsRoot, entry.name);
      try {
        const summary = JSON.parse(await fs.readFile(join(directory, 'summary.json'), 'utf-8')) as any;
        return {
          hash: entry.name,
          passed: summary.passed === true,
          createdAt: summary.createdAt,
          model: summary.runtime?.model,
          aoBaseUrl: summary.runtime?.aoBaseUrl,
          jobId: summary.job?.id,
          url: summary.job?.url,
          caseCount: Array.isArray(summary.cases) ? new Set(summary.cases.map((item: any) => item.case?.id).filter(Boolean)).size : undefined,
          runCount: Array.isArray(summary.cases) ? summary.cases.length : undefined,
          policy: summary.policy,
          reasons: Array.isArray(summary.reasons) ? summary.reasons : [],
          path: directory,
        };
      } catch {
        return null;
      }
    }));

  return evaluations
    .filter((evaluation): evaluation is NonNullable<typeof evaluation> => Boolean(evaluation))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 20);
}
