import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/tasks', () => {
    return HttpResponse.json({
      data: {
        tasks: [],
        total: 0,
      },
    });
  }),

  http.get('/api/status', () => {
    return HttpResponse.json({
      data: {
        version: '0.1.0',
        uptime: 0,
        activeTasks: 0,
        queuedTasks: 0,
      },
    });
  }),

  http.get('/api/config', () => {
    return HttpResponse.json({
      data: {
        download: {
          directory: './downloads',
          concurrency: 5,
          namingTemplate: '{title}/{chapter}/{index}',
          imageFormat: 'original',
          imageQuality: 100,
        },
        concurrency: {
          taskLevel: 3,
          siteLevel: 2,
        },
        network: {
          timeout: 30000,
          retries: 3,
          retryDelay: 1000,
        },
        server: {
          port: 4100,
          host: '127.0.0.1',
        },
        log: {
          level: 'info',
        },
        i18n: {
          language: 'zh-TW',
          fallback: 'en',
        },
      },
    });
  }),
];
