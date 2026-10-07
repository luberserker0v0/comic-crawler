import React from 'react';
import { useConfigStore } from '../store';
import { useI18n } from '../text/i18n';
import { api } from '../api/client';
import { useConfigForm } from './settings/useConfigForm';
import { useSelectorDiscoverySettings } from './settings/useSelectorDiscoverySettings';
import { GeneralSettingsSection } from './settings/sections/GeneralSettingsSection';
import { BrowserSettingsSection } from './settings/sections/BrowserSettingsSection';
import { SelectorDiscoverySection } from './settings/sections/SelectorDiscoverySection';

export const SettingsPage: React.FC = () => {
  const { config, loading, error, fetchConfig, updateConfig, resetConfig, clearError } = useConfigStore();
  const { form, handleChange, handleNestedChange, handleSave, handleReset } = useConfigForm({ config, updateConfig, resetConfig });
  const {
    selectorDiscoveryConfig,
    selectorDiscoveryBundleStatus,
    selectorDiscoveryBundleEvaluations,
    selectorDiscoveryAoModels,
    selectorDiscoveryAoModelsLoading,
    aoBaseUrl,
    setAoBaseUrl,
    model,
    setModel,
    providerJson,
    setProviderJson,
    selectorDiscoveryMessage,
    selectorDiscoveryPreflight,
    refreshSelectorDiscoveryBundleStatus,
    refreshSelectorDiscoveryBundleEvaluations,
    handleSelectorDiscoverySave,
    handleLoadDefaultSelectorDiscoveryProvider,
    handleSelectorDiscoveryClear,
    handleSelectorDiscoveryTest,
    handleRefreshSelectorDiscoveryAoModels,
  } = useSelectorDiscoverySettings({ fetchConfig });
  const [cdpTestMessage, setCdpTestMessage] = React.useState<string | null>(null);
  const [downloadDirectoryMessage, setDownloadDirectoryMessage] = React.useState<string | null>(null);
  const { text } = useI18n();

  const handleCdpTest = async () => {
    setCdpTestMessage(null);
    try {
      const cdpUrl = (form as any).browser?.handoff?.cdpUrl;
      const response = await api.testChallengeDiscoveryCdp(cdpUrl);
      setCdpTestMessage(`Connected. Pages: ${response.data.pageCount}. ${response.data.pages?.[0]?.title ?? response.data.pages?.[0]?.url ?? ''}`);
    } catch (err: any) {
      setCdpTestMessage(err.response?.data?.error ?? err.message);
    }
  };

  const handleBrowseDownloadDirectory = async () => {
    setDownloadDirectoryMessage(null);
    try {
      const response = await api.browseDownloadDirectory();
      if (response.data.directory) {
        handleChange('download', 'directory', response.data.directory);
      }
    } catch (err: any) {
      setDownloadDirectoryMessage(err.response?.data?.error ?? err.message);
    }
  };

  const handleOpenDownloadDirectory = async () => {
    setDownloadDirectoryMessage(null);
    try {
      const directory = (form as any).download?.directory;
      const response = await api.openDownloadDirectory(directory);
      setDownloadDirectoryMessage(`Opened ${response.data.directory}`);
    } catch (err: any) {
      setDownloadDirectoryMessage(err.response?.data?.error ?? err.message);
    }
  };

  if (loading && !config) {
    return <div className="py-8 text-center">{text.settings.loading}</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <div className="text-red-600">{error}</div>
        <button onClick={clearError} className="mt-2 text-blue-600 hover:underline">
          {text.settings.dismissError}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">{text.settings.title}</h1>

      <GeneralSettingsSection
        form={form}
        handleChange={handleChange}
        downloadDirectoryMessage={downloadDirectoryMessage}
        handleBrowseDownloadDirectory={handleBrowseDownloadDirectory}
        handleOpenDownloadDirectory={handleOpenDownloadDirectory}
      />

      <BrowserSettingsSection
        form={form}
        handleChange={handleChange}
        handleNestedChange={handleNestedChange}
        cdpTestMessage={cdpTestMessage}
        handleCdpTest={handleCdpTest}
      />

      <SelectorDiscoverySection
        aoBaseUrl={aoBaseUrl}
        setAoBaseUrl={setAoBaseUrl}
        model={model}
        setModel={setModel}
        providerJson={providerJson}
        setProviderJson={setProviderJson}
        selectorDiscoveryConfig={selectorDiscoveryConfig}
        selectorDiscoveryBundleStatus={selectorDiscoveryBundleStatus}
        selectorDiscoveryBundleEvaluations={selectorDiscoveryBundleEvaluations}
        selectorDiscoveryAoModels={selectorDiscoveryAoModels}
        selectorDiscoveryAoModelsLoading={selectorDiscoveryAoModelsLoading}
        selectorDiscoveryMessage={selectorDiscoveryMessage}
        selectorDiscoveryPreflight={selectorDiscoveryPreflight}
        refreshSelectorDiscoveryBundleStatus={refreshSelectorDiscoveryBundleStatus}
        refreshSelectorDiscoveryBundleEvaluations={refreshSelectorDiscoveryBundleEvaluations}
        handleSelectorDiscoverySave={handleSelectorDiscoverySave}
        handleLoadDefaultSelectorDiscoveryProvider={handleLoadDefaultSelectorDiscoveryProvider}
        handleSelectorDiscoveryClear={handleSelectorDiscoveryClear}
        handleSelectorDiscoveryTest={handleSelectorDiscoveryTest}
        handleRefreshSelectorDiscoveryAoModels={handleRefreshSelectorDiscoveryAoModels}
      />

      <div className="flex space-x-4">
        <button
          onClick={handleSave}
          data-testid="settings-save-button"
          className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {text.settings.save}
        </button>
        <button
          onClick={handleReset}
          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {text.settings.reset}
        </button>
      </div>
    </div>
  );
};
