export { api, ApiClient } from './api/client';
export type { ApiResponse } from './api/client';

export { useTaskStore, useConfigStore, useAdapterStore } from './store';
export type { Task, TaskStats, TaskDetail, GlobalConfig, Adapter } from './store';

export { useWebSocket, useLocalStorage } from './hooks';

export { ProgressBar } from './components/ProgressBar';
export { TaskList } from './components/TaskList';
export { NewTaskForm } from './components/NewTaskForm';
export { StatsCard } from './components/StatsCard';

export { DashboardPage } from './pages/DashboardPage';
export { TaskManagerPage } from './pages/TaskManagerPage';
export { SettingsPage } from './pages/SettingsPage';
export { I18nProvider, useI18n, SUPPORTED_LOCALES } from './text/i18n';

export { default as App } from './App';
