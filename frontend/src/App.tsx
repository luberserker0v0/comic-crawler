import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { TaskManagerPage } from './pages/TaskManagerPage';
import { SettingsPage } from './pages/SettingsPage';
import { AgentPage } from './pages/AgentPage';
import { SUPPORTED_LOCALES, type LocaleCode, useI18n } from './text/i18n';

const App: React.FC = () => {
  const { locale, setLocale, text } = useI18n();

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen bg-gray-100">
        <nav className="bg-white shadow-sm">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <span className="text-xl font-bold text-blue-600">ComicCrawler</span>
                </div>
                <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <Link
                    to="/"
                    className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  >
                    {text.nav.dashboard}
                  </Link>
                  <Link
                    to="/tasks"
                    className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  >
                    {text.nav.tasks}
                  </Link>
                  <Link
                    to="/settings"
                    data-testid="nav-settings"
                    className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  >
                    {text.nav.settings}
                  </Link>
                  <Link
                    to="/agent"
                    className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  >
                    {text.nav.agent}
                  </Link>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="locale" className="text-sm text-gray-500">
                  {text.nav.language}
                </label>
                <select
                  id="locale"
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as LocaleCode)}
                  className="rounded-md border-gray-300 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  {SUPPORTED_LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {text.language[code]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </nav>

        <main className="py-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tasks" element={<TaskManagerPage />} />
            <Route path="/tasks/:taskId" element={<TaskManagerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/agent" element={<AgentPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
};

export default App;
