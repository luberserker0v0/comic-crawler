import { useState } from 'react';
import type { GlobalConfig } from '../../store';

export function useConfigForm(options: {
  config: GlobalConfig | null | undefined;
  updateConfig: (config: Partial<GlobalConfig>) => Promise<void>;
  resetConfig: () => Promise<void>;
}) {
  const { config, updateConfig, resetConfig } = options;
  const [formDraft, setForm] = useState<Partial<GlobalConfig> | null>(null);
  const form = formDraft ?? config ?? {};

  const handleChange = (section: string, key: string, value: any) => {
    setForm((previousDraft) => {
      const previous = previousDraft ?? config ?? {};
      return {
      ...previous,
      [section]: {
        ...(previous as any)[section],
        [key]: value,
      },
    };
    });
  };

  const handleNestedChange = (section: string, nested: string, key: string, value: any) => {
    setForm((previousDraft) => {
      const previous = previousDraft ?? config ?? {};
      const sectionValue = (previous as any)[section] ?? {};
      return {
        ...previous,
        [section]: {
          ...sectionValue,
          [nested]: {
            ...(sectionValue as any)[nested],
            [key]: value,
          },
        },
      };
    });
  };

  const handleSave = async () => {
    await updateConfig(form);
    setForm(null);
  };

  const handleReset = async () => {
    await resetConfig();
    setForm(null);
  };

  return {
    form,
    handleChange,
    handleNestedChange,
    handleSave,
    handleReset,
  };
}
