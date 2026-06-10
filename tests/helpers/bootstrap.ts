import http from 'http';
import Redis from 'ioredis';
import type { Logger } from 'pino';

import { loadEnv } from '@/config/env';
import type { Env } from '@/config/env';
import { createLogger } from '@/infrastructure/logger';
import { RedisRateLimitStore } from '@/infrastructure/redis-rate-limit-store';
import { createApp } from '@/app';
import { attachWebSocketProxy } from '@/proxy/ws-proxy';

import { startRedis } from './redis-container';
import { createStubUpstream } from './stub-upstream';
import type { StubUpstream } from './stub-upstream';
import { JWT_SECRET, SERVICE_JWT_SECRET } from './jwt-fixtures';

export interface BootstrapOverrides {
  /** Override env vars set on the gateway under test. Useful e.g. for rate-limit windows. */
  envOverrides?: Record<string, string>;
  /** Skip starting the user-service stub (useful when a test only exercises auth). */
  skipUserStub?: boolean;
  /** Start a tracking-service stub and wire TRACKING_SERVICE_URL. */
  withTrackingStub?: boolean;
  /** Start a notification-service stub and wire NOTIFICATION_SERVICE_URL. */
  withNotificationStub?: boolean;
  /** Point AUTH_SERVICE_URL at this URL instead of starting an authStub (used to test connection-refused). */
  authServiceUrl?: string;
  /** Inject a custom pino Logger. Useful for capturing log output in tests (e.g. redaction tests). */
  logger?: Logger;
}

export interface Bootstrap {
  env: Env;
  server: http.Server;
  port: number;
  authStub: StubUpstream | null;
  userStub: StubUpstream | null;
  trackingStub: StubUpstream | null;
  notificationStub: StubUpstream | null;
  redis: Redis;
  redisInfo: Awaited<ReturnType<typeof startRedis>>;
  /** Forces `/readyz` and the drain gate to act as if SIGTERM has fired. */
  setShuttingDown: (v: boolean) => void;
  close: () => Promise<void>;
}

export async function bootstrap(overrides: BootstrapOverrides = {}): Promise<Bootstrap> {
  const redisInfo = await startRedis();

  const authStub = overrides.authServiceUrl ? null : await createStubUpstream();
  const userStub = overrides.skipUserStub ? null : await createStubUpstream();
  const trackingStub = overrides.withTrackingStub ? await createStubUpstream() : null;
  const notificationStub = overrides.withNotificationStub ? await createStubUpstream() : null;

  const baseEnv: Record<string, string> = {
    NODE_ENV: 'test',
    GATEWAY_PORT: '8080',
    JWT_SECRET,
    SERVICE_JWT_SECRET,
    REDIS_URL: redisInfo.url,
    AUTH_SERVICE_URL: overrides.authServiceUrl ?? authStub!.url,
    USER_SERVICE_URL: userStub?.url ?? 'http://127.0.0.1:1',
    GATEWAY_CORS_ORIGINS: 'http://localhost:3000',
    ...(trackingStub ? { TRACKING_SERVICE_URL: trackingStub.url } : {}),
    ...(notificationStub ? { NOTIFICATION_SERVICE_URL: notificationStub.url } : {}),
    ...(overrides.envOverrides ?? {}),
  };

  const env = loadEnv(baseEnv);
  const logger = overrides.logger ?? createLogger({ level: 'silent', serviceName: 'test' });
  const redis = new Redis(env.REDIS_URL);
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
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  return {
    env,
    server,
    port,
    authStub,
    userStub,
    trackingStub,
    notificationStub,
    redis,
    redisInfo,
    setShuttingDown: (v) => {
      shuttingDown = v;
    },
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await redis.quit().catch(() => undefined);
      if (authStub) await authStub.close();
      if (userStub) await userStub.close();
      if (trackingStub) await trackingStub.close();
      if (notificationStub) await notificationStub.close();
      await redisInfo.stop();
    },
  };
}
