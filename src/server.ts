import http from 'node:http';

import { loadEnv } from './config/env.js';
import { createLogger } from './infrastructure/logger.js';
import { createRedisClient } from './infrastructure/redis.js';
import { RedisRateLimitStore } from './infrastructure/redis-rate-limit-store.js';
import { createApp } from './app.js';
import { attachWebSocketProxy } from './proxy/ws-proxy.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ level: env.LOG_LEVEL, serviceName: env.LOG_SERVICE_NAME });

  const redis = createRedisClient(env.REDIS_URL);
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

  server.listen(env.GATEWAY_PORT, () => {
    logger.info({ event: 'gateway_started', port: env.GATEWAY_PORT }, 'gateway listening');
  });

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
  console.error('gateway failed to start', err);
  process.exit(1);
});
