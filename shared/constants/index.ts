export const API_ENDPOINTS = {
  tasks: '/api/tasks',
  adapters: '/api/adapters',
  config: '/api/config',
  search: '/api/search',
  schedules: '/api/schedules',
  export: '/api/export',
  import: '/api/import',
  i18n: '/api/i18n',
  notifications: '/api/notifications',
  status: '/api/status',
} as const;

export const WS_EVENTS = {
  client: {
    taskCreate: 'task:create',
    taskBatch: 'task:batch',
    taskPause: 'task:pause',
    taskResume: 'task:resume',
    taskCancel: 'task:cancel',
    subscribe: 'subscribe',
    unsubscribe: 'unsubscribe',
    search: 'search',
    configUpdate: 'config:update',
    i18nSetLanguage: 'i18n:setLanguage',
  },
  server: {
    taskCreated: 'task:created',
    taskProgress: 'task:progress',
    taskCompleted: 'task:completed',
    taskFailed: 'task:failed',
    taskPaused: 'task:paused',
    taskResumed: 'task:resumed',
    taskCancelled: 'task:cancelled',
    searchResults: 'search:results',
    configChanged: 'config:changed',
    adapterRegistered: 'adapter:registered',
    scheduleTriggered: 'schedule:triggered',
    notificationNew: 'notification:new',
    i18nChanged: 'i18n:changed',
    systemStatus: 'system:status',
  },
} as const;

export const DEFAULTS = {
  concurrency: {
    taskLevel: 3,
    siteLevel: 2,
    imageLevel: 5,
  },
  network: {
    timeout: 30000,
    retries: 3,
    retryDelay: 1000,
  },
  browser: {
    mode: 'auto' as const,
    headless: true,
    maxInstances: 2,
    timeout: 30000,
    waitUntil: 'domcontentloaded' as const,
    postLoadDelayMs: 0,
    challengeAutoAttempt: true,
    challengeWaitMs: 15000,
    handoff: {
      mode: 'snapshot' as const,
    },
  },
  server: {
    port: 4100,
    host: '127.0.0.1',
  },
  i18n: {
    language: 'zh-TW',
    fallback: 'en',
  },
  download: {
    namingTemplate: '{title}/{chapter}/{index}',
    imageFormat: 'original' as const,
    imageQuality: 100,
  },
} as const;
