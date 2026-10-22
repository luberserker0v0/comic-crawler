import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { TaskManagerPage } from './pages/TaskManagerPage';
import { SettingsPage } from './pages/SettingsPage';
import { AgentPage } from './pages/AgentPage';
import { AdapterLabPage } from './pages/AdapterLabPage';
import { SUPPORTED_LOCALES, type LocaleCode, useI18n } from './text/i18n';

const App: React.FC = () => {
  const { locale, setLocale, text } = useI18n();
  return <BrowserRouter><div className="min-h-screen bg-gray-100">
    <Navigation locale={locale} setLocale={setLocale} text={text} />
    <main className="py-6"><AppRoutes /></main>
  </div></BrowserRouter>;
};

type NavigationProps = { locale: LocaleCode; setLocale(code: LocaleCode): void; text: ReturnType<typeof useI18n>['text'] };

function Navigation({ locale, setLocale, text }: NavigationProps) {
  return <nav className="bg-white shadow-sm"><div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <div className="flex h-16 items-center justify-between">
      <div className="flex items-center">
        <span className="text-xl font-bold text-blue-600">ComicCrawler</span>
        <NavigationLinks text={text} />
      </div>
      <LocaleSelector locale={locale} setLocale={setLocale} text={text} />
    </div>
  </div></nav>;
}

function NavigationLinks({ text }: Pick<NavigationProps, 'text'>) {
  const links = [
    ['/', text.nav.dashboard], ['/tasks', text.nav.tasks], ['/settings', text.nav.settings],
    ['/agent', text.nav.agent], ['/adapter-lab', 'Adapter Lab'],
  ];
  return <div className="hidden sm:ml-6 sm:flex sm:space-x-8">{links.map(([to, label]) =>
    <Link key={to} to={to} data-testid={to === '/settings' ? 'nav-settings' : undefined}
      className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700">
      {label}
    </Link>)}</div>;
}

function LocaleSelector({ locale, setLocale, text }: NavigationProps) {
  return <div className="flex items-center gap-2">
    <label htmlFor="locale" className="text-sm text-gray-500">{text.nav.language}</label>
    <select id="locale" value={locale} onChange={(event) => setLocale(event.target.value as LocaleCode)}
      className="rounded-md border-gray-300 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500">
      {SUPPORTED_LOCALES.map((code) => <option key={code} value={code}>{text.language[code]}</option>)}
    </select>
  </div>;
}

function AppRoutes() {
  return <Routes>
    <Route path="/" element={<DashboardPage />} />
    <Route path="/tasks" element={<TaskManagerPage />} />
    <Route path="/tasks/:taskId" element={<TaskManagerPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/agent" element={<AgentPage />} />
    <Route path="/adapter-lab" element={<AdapterLabPage />} />
  </Routes>;
}

export default App;
