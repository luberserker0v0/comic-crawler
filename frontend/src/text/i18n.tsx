import React, { createContext, useContext, useMemo } from 'react';
import { useLocalStorage } from '../hooks';
import { useConfigStore } from '../store/configStore';
import { enUSText } from './enUS';
import { uiText, type UIText } from './zhTW';

export const SUPPORTED_LOCALES = ['zh-TW', 'en-US'] as const;
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

const LOCALE_STORAGE_KEY = 'ui:locale';

const localeTexts = {
  'zh-TW': uiText,
  'en-US': enUSText,
} as const;

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  text: UIText;
}

function normalizeLocale(value?: string | null): LocaleCode {
  if (value === 'en-US') {
    return 'en-US';
  }

  return 'zh-TW';
}

function readConfigLocale(value?: string | null): LocaleCode | null {
  if (!value) {
    return null;
  }

  return normalizeLocale(value);
}

function getBrowserLocale(): LocaleCode {
  if (typeof navigator === 'undefined') {
    return 'zh-TW';
  }

  return normalizeLocale(navigator.language === 'en-US' ? 'en-US' : 'zh-TW');
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-TW',
  setLocale: () => undefined,
  text: uiText,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [storedLocale, setStoredLocale] = useLocalStorage<LocaleCode>(LOCALE_STORAGE_KEY, getBrowserLocale());
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateLanguage = useConfigStore((state) => state.updateLanguage);
  const configLocale = readConfigLocale(config?.i18n?.language);
  const locale = configLocale ?? normalizeLocale(storedLocale);

  React.useEffect(() => {
    if (!config) {
      void fetchConfig();
    }
  }, [config, fetchConfig]);

  React.useEffect(() => {
    if (configLocale && configLocale !== storedLocale) {
      setStoredLocale(configLocale);
    }
  }, [configLocale, storedLocale, setStoredLocale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: (nextLocale) => {
      const normalized = normalizeLocale(nextLocale);
      setStoredLocale(normalized);
      void updateLanguage(normalized);
    },
    text: localeTexts[locale],
  }), [locale, setStoredLocale, updateLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function formatText(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value)),
    template
  );
}
