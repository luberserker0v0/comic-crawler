import React from 'react';
import { useConfigStore } from '../store';
import { useI18n } from '../text/i18n';
import { formatText } from '../text/format';
import { api } from '../api/client';
import { useConfigForm } from './settings/useConfigForm';
import { useSelectorDiscoverySettings } from './settings/useSelectorDiscoverySettings';
import { GeneralSettingsSection } from './settings/sections/GeneralSettingsSection';
import { BrowserSettingsSection } from './settings/sections/BrowserSettingsSection';
import { SelectorDiscoverySection } from './settings/sections/SelectorDiscoverySection';

export const SettingsPage: React.FC = () => {
  const { config, loading, error, fetchConfig, updateConfig, resetConfig, clearError } = useConfigStore();
  const formState = useConfigForm({ config, updateConfig, resetConfig });
  const selectorState = useSelectorDiscoverySettings({ fetchConfig });
  const { text } = useI18n();
  const directoryState = useDownloadDirectory(formState.form, formState.handleChange, text);
  if (loading && !config) return <div className="py-8 text-center">{text.settings.loading}</div>;
  if (error) return <SettingsError error={error} clearError={clearError} text={text} />;
  return <SettingsContent formState={formState} selectorState={selectorState} directoryState={directoryState} text={text} />;
};

type SettingsText = ReturnType<typeof useI18n>['text'];
type FormState = ReturnType<typeof useConfigForm>;
type SelectorState = ReturnType<typeof useSelectorDiscoverySettings>;

function useDownloadDirectory(form: FormState['form'], handleChange: FormState['handleChange'], text: SettingsText) {
  const [downloadDirectoryMessage, setDownloadDirectoryMessage] = React.useState<string | null>(null);
  const handleBrowseDownloadDirectory = createBrowseHandler(handleChange, setDownloadDirectoryMessage);
  const handleOpenDownloadDirectory = createOpenHandler(form, text, setDownloadDirectoryMessage);
  return { downloadDirectoryMessage, handleBrowseDownloadDirectory, handleOpenDownloadDirectory };
}

function createBrowseHandler(handleChange: FormState['handleChange'], setMessage: (value: string | null) => void) {
  return async () => {
    setMessage(null);
    try {
      const response = await api.browseDownloadDirectory();
      if (response.data.directory) handleChange('download', 'directory', response.data.directory);
    } catch (err: any) {
      setMessage(err.response?.data?.error ?? err.message);
    }
  };
}

function createOpenHandler(form: FormState['form'], text: SettingsText, setMessage: (value: string | null) => void) {
  return async () => {
    setMessage(null);
    try {
      const directory = (form as any).download?.directory;
      const response = await api.openDownloadDirectory(directory);
      setMessage(formatText(text.settings.openedDirectory, { directory: response.data.directory }));
    } catch (err: any) {
      setMessage(err.response?.data?.error ?? err.message);
    }
  };
}

function SettingsError({ error, clearError, text }: { error: string; clearError(): void; text: SettingsText }) {
  return <div className="py-8 text-center"><div className="text-red-600">{error}</div>
    <button onClick={clearError} className="mt-2 text-blue-600 hover:underline">{text.settings.dismissError}</button>
  </div>;
}

function SettingsContent(props: { formState: FormState; selectorState: SelectorState;
  directoryState: ReturnType<typeof useDownloadDirectory>; text: SettingsText }) {
  const { formState, selectorState, directoryState, text } = props;
  return <div className="mx-auto max-w-4xl space-y-6">
    <h1 className="text-2xl font-bold">{text.settings.title}</h1>
    <GeneralSettingsSection form={formState.form} handleChange={formState.handleChange} {...directoryState} />
    <BrowserSettingsSection form={formState.form} handleChange={formState.handleChange} />
    <SelectorDiscoverySection {...selectorState} />
    <SettingsActions handleSave={formState.handleSave} handleReset={formState.handleReset} text={text} />
  </div>;
}

function SettingsActions({ handleSave, handleReset, text }: { handleSave(): Promise<void>; handleReset(): Promise<void>; text: SettingsText }) {
  return <div className="flex space-x-4">
    <button onClick={() => void handleSave()} data-testid="settings-save-button"
      className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">{text.settings.save}</button>
    <button onClick={() => void handleReset()}
      className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">{text.settings.reset}</button>
  </div>;
}
