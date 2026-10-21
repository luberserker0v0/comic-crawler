import { describe, expect, it } from '@jest/globals';
import {
  assertModelExists,
  diagnoseProviderDocument,
  listProviderModelIds,
  mergeProviderIntoOpenCodeConfig,
  validateProviderDocument,
} from '../../../src/selector-discovery/provider-config';

const document = validateProviderDocument({
    provider: {
      my_local_lmstudio: {
        name: 'my local lmstudio',
        models: {
          'gemma-4-e4b-uncensored-hauhaucs-aggressive': { name: 'gemma' },
        },
      },
    },
  });

describe('selector-discovery provider config', () => {
  selectorDiscoveryProviderConfigTestGroup1();
});

function selectorDiscoveryProviderConfigTestGroup1(): void {
  it('requires the selected model to exist in the provider document', selectorDiscoveryProviderConfigTestRequiresTheSelectedModelToExistInTheProviderDocument);
  it('lists provider and fully qualified model ids without exposing options', selectorDiscoveryProviderConfigTestListsProviderAndFullyQualifiedModelIdsWithoutExposingOptions);
  it('overwrites opencode provider with the user supplied provider field', selectorDiscoveryProviderConfigTestOverwritesOpencodeProviderWithTheUserSuppliedProviderField);
  it('warns when provider file references look invisible to AO Docker/Linux runtimes', selectorDiscoveryProviderConfigTestWarnsWhenProviderFileReferencesLookInvisibleToAODockerLinuxRuntimes);
}

function selectorDiscoveryProviderConfigTestRequiresTheSelectedModelToExistInTheProviderDocument() {
    expect(() => assertModelExists(document, 'my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive')).not.toThrow();
    expect(() => assertModelExists(document, 'my_local_lmstudio/missing')).toThrow(/not found/);
}

function selectorDiscoveryProviderConfigTestListsProviderAndFullyQualifiedModelIdsWithoutExposingOptions() {
    expect(listProviderModelIds(document)).toEqual({
        providerIds: ['my_local_lmstudio'],
        modelIds: ['my_local_lmstudio/gemma-4-e4b-uncensored-hauhaucs-aggressive'],
    });
}

function selectorDiscoveryProviderConfigTestOverwritesOpencodeProviderWithTheUserSuppliedProviderField() {
    const merged = mergeProviderIntoOpenCodeConfig({ provider: { old: {} }, permission: { read: 'allow' } }, document);
    expect(merged).toEqual({
        permission: { read: 'allow' },
        provider: document.provider,
    });
}

function selectorDiscoveryProviderConfigTestWarnsWhenProviderFileReferencesLookInvisibleToAODockerLinuxRuntimes() {
    const warnings = diagnoseProviderDocument(validateProviderDocument({
        provider: {
            my_local_lmstudio: {
                options: {
                    baseURL: 'http://host.docker.internal:25555/v1',
                    apiKey: '{file:C:\\Users\\berserker\\Documents\\lmstudio api token.txt}',
                },
                models: {
                    'gemma-4-e4b-uncensored-hauhaucs-aggressive': {},
                },
            },
        },
    }));
    expect(warnings.some((warning) => warning.includes('Windows file reference'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('host.docker.internal'))).toBe(true);
}
