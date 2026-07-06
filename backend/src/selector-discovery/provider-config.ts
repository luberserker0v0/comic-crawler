import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ProviderDocument } from './types';

const ProviderDocumentSchema = z.object({
  provider: z.record(z.object({
    name: z.string().optional(),
    npm: z.string().optional(),
    options: z.record(z.unknown()).optional(),
    models: z.record(z.object({ name: z.string().optional() })).optional(),
  })),
});

export function validateProviderDocument(value: unknown): ProviderDocument {
  const parsed = ProviderDocumentSchema.parse(value);
  if (Object.keys(parsed.provider).length === 0) {
    throw new Error('Provider document must include at least one provider.');
  }
  return parsed;
}

export function listProviderModelIds(document: ProviderDocument): { providerIds: string[]; modelIds: string[] } {
  const providerIds = Object.keys(document.provider);
  const modelIds = providerIds.flatMap((providerId) =>
    Object.keys(document.provider[providerId]?.models ?? {}).map((modelId) => `${providerId}/${modelId}`)
  );
  return { providerIds, modelIds };
}

export function assertModelExists(document: ProviderDocument, model: string): void {
  const [providerId, ...modelParts] = model.split('/');
  const modelId = modelParts.join('/');
  if (!providerId || !modelId) {
    throw new Error('Model must use the "<provider>/<model>" format.');
  }

  if (!document.provider[providerId]?.models?.[modelId]) {
    throw new Error(`Model "${model}" was not found in the provider document.`);
  }
}

export function fingerprintProviderDocument(document: ProviderDocument): string {
  return createHash('sha256').update(JSON.stringify(document.provider)).digest('hex');
}

export function mergeProviderIntoOpenCodeConfig(baseConfig: Record<string, unknown>, providerDocument: ProviderDocument): Record<string, unknown> {
  return {
    ...baseConfig,
    provider: providerDocument.provider,
  };
}

export function diagnoseProviderDocument(document: ProviderDocument): string[] {
  const warnings: string[] = [];

  for (const [providerId, provider] of Object.entries(document.provider)) {
    const apiKey = provider.options?.apiKey;
    if (typeof apiKey === 'string') {
      const fileRef = /^\{file:(.+)\}$/.exec(apiKey);
      if (fileRef) {
        const filePath = fileRef[1]!;
        if (/^[A-Za-z]:\\/.test(filePath)) {
          warnings.push(
            `Provider "${providerId}" uses a Windows file reference (${filePath}). AO/OpenCode must be able to read this path from its own runtime environment; containerized AO usually needs a mounted Linux path instead.`
          );
        }
        if (filePath.includes('\\')) {
          warnings.push(
            `Provider "${providerId}" file reference contains backslashes. If AO runs in Linux/Docker, prefer an AO-visible POSIX path such as {file:/data/secrets/lmstudio-api-token.txt}.`
          );
        }
      }
    }

    if (typeof provider.options?.baseURL === 'string' && provider.options.baseURL.includes('host.docker.internal')) {
      warnings.push(
        `Provider "${providerId}" uses host.docker.internal. This works only when AO/OpenCode runs in an environment where that hostname resolves to the host.`
      );
    }
  }

  return Array.from(new Set(warnings));
}
