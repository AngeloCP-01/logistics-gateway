import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';
import pinoHttp from 'pino-http';
import type { HttpLogger } from 'pino-http';

export function createLogger(opts: { level: string; serviceName: string }): Logger {
  const options: LoggerOptions = {
    level: opts.level,
    base: { service: opts.serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-service-authorization"]',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
  };
  return pino(options);
}

export function createHttpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    customSuccessMessage: () => 'request_completed',
    customErrorMessage: () => 'request_errored',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-service-authorization"]',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
  });
}
