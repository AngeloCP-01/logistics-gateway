import http from 'node:http';

import { loadEnv } from './config/env.js';
import { createLogger } from './infrastructure/logger.js';
import { createRedisClient } from './infrastructure/redis.js';
import { RedisRateLimitStore } from './infrastructure/redis-rate-limit-store.js';
import { createApp } from './app.js';
import { attachWebSocketProxy } from './proxy/ws-proxy.js';

/**
 * A boot-time failure attributed to a specific dependency/config, so the log
 * names WHAT failed (Redis? the port?) and how to fix it — instead of
 * surfacing a raw driver message with no context.
 */
class BootError extends Error {
  constructor(
    readonly dependency: string,
    readonly envVar: string | null,
    readonly hint: string | null,
    cause: unknown,
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to ${dependency}${envVar ? ` (check ${envVar})` : ''}: ${causeMsg}` +
        (hint ? ` — ${hint}` : ''),
    );
    this.name = 'BootError';
  }
}

async function bootStep<T>(
  meta: { what: string; envVar?: string; hint?: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new BootError(meta.what, meta.envVar ?? null, meta.hint ?? null, cause);
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, serviceName: env.LOG_SERVICE_NAME });

  // ioredis connects lazily — the constructor won't throw on a bad host.
  // Override maxRetriesPerRequest + connectTimeout so a bad REDIS_URL fails
  // fast at boot rather than hanging indefinitely.
  // Attach a no-op error listener before the ping so ioredis connection errors
  // that fire as EventEmitter events don't cause an "Unhandled error event"
  // crash before the promise rejection propagates to bootStep.
  const redis = createRedisClient(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  redis.on('error', () => undefined);
  await bootStep(
    {
      what: 'connect to Redis',
      envVar: 'REDIS_URL',
      hint: 'is Redis running and REDIS_URL correct?',
    },
    () => redis.ping(),
  );

  const rateLimitStore = new RedisRateLimitStore(redis);

  let shuttingDown = false;
  const app = createApp({
    env,
    logger,
    rateLimitStore,
    redis,
    shuttingDown: () => shuttingDown,
  });
  const server = http.createServer(app);
  attachWebSocketProxy(server, env);

  await bootStep(
    { what: 'bind the HTTP server', envVar: 'GATEWAY_PORT', hint: 'is the port already in use?' },
    () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(env.GATEWAY_PORT, () => {
          server.off('error', reject);
          resolve();
        });
      }),
  );
  logger.info({ event: 'gateway_started', port: env.GATEWAY_PORT }, 'gateway listening');

  const shutdown = (signal: string): void => {
    logger.info({ event: 'shutdown_signal', signal }, 'received shutdown signal');
    shuttingDown = true;
    const forceExit = setTimeout(() => {
      logger.warn({ event: 'gateway_forced_exit' }, 'forced exit after grace period');
      process.exit(1);
    }, env.GATEWAY_SHUTDOWN_GRACE_MS).unref();
    server.close(async () => {
      await redis.quit().catch(() => undefined);
      clearTimeout(forceExit);
      logger.info({ event: 'gateway_stopped' }, 'gateway stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  const isBoot = err instanceof BootError;
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      event: 'boot_failed',
      dependency: isBoot ? err.dependency : undefined,
      configHint: isBoot ? (err.envVar ?? undefined) : undefined,
      message: err instanceof Error ? err.message : String(err),
    }) + '\n',
  );
  process.exit(1);
});
