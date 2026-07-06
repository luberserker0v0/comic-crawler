import type { IStorage } from '../storage/types';
import type { ProviderDocument, SelectorDiscoverySettings, SelectorDiscoverySettingsSummary } from './types';
import { assertModelExists, diagnoseProviderDocument, fingerprintProviderDocument, listProviderModelIds, validateProviderDocument } from './provider-config';

const SETTINGS_KEY = 'selector-discovery-settings';
const PROVIDER_KEY = 'selector-discovery-provider';

export class SelectorDiscoverySettingsStore {
  constructor(private readonly storage: IStorage) {}

  async getSummary(): Promise<SelectorDiscoverySettingsSummary> {
    const settings = await this.storage.read<SelectorDiscoverySettings>(SETTINGS_KEY);
    if (!settings) {
      return { configured: false, providerIds: [], modelIds: [] };
    }
    return {
      configured: true,
      aoBaseUrl: settings.aoBaseUrl,
      model: settings.model,
      providerFingerprint: settings.providerFingerprint,
      providerIds: settings.providerIds,
      modelIds: settings.modelIds,
      configuredAt: settings.configuredAt,
      warnings: settings.warnings ?? [],
    };
  }

  async getRequired(): Promise<{ settings: SelectorDiscoverySettings; providerDocument: ProviderDocument }> {
    const settings = await this.storage.read<SelectorDiscoverySettings>(SETTINGS_KEY);
    const providerDocument = await this.storage.read<ProviderDocument>(PROVIDER_KEY);
    if (!settings || !providerDocument) {
      throw new Error('Selector discovery is not configured.');
    }
    return { settings, providerDocument };
  }

  async save(input: { aoBaseUrl: string; model: string; providerDocument: unknown }): Promise<SelectorDiscoverySettingsSummary> {
    if (!input.aoBaseUrl?.trim()) {
      throw new Error('AO URL is required.');
    }
    if (!input.model?.trim()) {
      throw new Error('Model is required.');
    }

    const providerDocument = validateProviderDocument(input.providerDocument);
    assertModelExists(providerDocument, input.model);
    const { providerIds, modelIds } = listProviderModelIds(providerDocument);
    const settings: SelectorDiscoverySettings = {
      aoBaseUrl: input.aoBaseUrl.trim().replace(/\/+$/, ''),
      model: input.model.trim(),
      providerFingerprint: fingerprintProviderDocument(providerDocument),
      providerIds,
      modelIds,
      configuredAt: new Date().toISOString(),
      warnings: diagnoseProviderDocument(providerDocument),
    };

    await this.storage.write(PROVIDER_KEY, providerDocument);
    await this.storage.write(SETTINGS_KEY, settings);
    return this.getSummary();
  }

  async clearProvider(): Promise<SelectorDiscoverySettingsSummary> {
    await this.storage.delete(PROVIDER_KEY);
    await this.storage.delete(SETTINGS_KEY);
    return this.getSummary();
  }
}
