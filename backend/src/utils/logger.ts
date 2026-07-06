import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  name?: string;
  transport?: {
    target: string;
    options?: Record<string, unknown>;
  };
}

const defaultOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'comiccrawler',
};

export function createLogger(options?: LoggerOptions) {
  const opts = { ...defaultOptions, ...options };

  const pinoOptions: pino.LoggerOptions = {
    name: opts.name,
    level: opts.level,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (process.env.NODE_ENV === 'test' && !opts.transport) {
    pinoOptions.enabled = false;
  } else if (process.env.NODE_ENV !== 'production' && !opts.transport) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  } else if (opts.transport) {
    pinoOptions.transport = opts.transport;
  }

  return pino(pinoOptions);
}

export type Logger = ReturnType<typeof createLogger>;

export const logger = createLogger();
