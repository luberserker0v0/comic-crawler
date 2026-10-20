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
  const pinoOptions = createPinoOptions(opts);
  configureTransport(pinoOptions, opts);
  return pino(pinoOptions);
}

function createPinoOptions(options: LoggerOptions): pino.LoggerOptions {
  return {
    name: options.name,
    level: options.level,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'request.headers.authorization',
        'headers.authorization',
        '*.token',
        '*.userToken',
        '*.credential',
        '*.providerCredential',
      ],
      censor: '[REDACTED]',
    },
  };
}

function configureTransport(pinoOptions: pino.LoggerOptions, options: LoggerOptions): void {
  if (process.env.NODE_ENV === 'test' && !options.transport) {
    pinoOptions.enabled = false;
  } else if (process.env.NODE_ENV !== 'production' && !options.transport) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  } else if (options.transport) {
    pinoOptions.transport = options.transport;
  }
}

export type Logger = ReturnType<typeof createLogger>;

export const logger = createLogger();
