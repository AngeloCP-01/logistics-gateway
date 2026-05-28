import type express from 'express';
import { mountProxyWithRetry } from './proxy-config';
import type { Env } from '@/config/env';

interface RouteSpec {
  pathPrefix: string;
  envKey: keyof Env;
  required: boolean;
  upstreamName: string;
}

const ROUTES: RouteSpec[] = [
  { pathPrefix: '/v1/auth',          envKey: 'AUTH_SERVICE_URL',         required: true,  upstreamName: 'auth-service' },
  { pathPrefix: '/v1/users',         envKey: 'USER_SERVICE_URL',         required: true,  upstreamName: 'user-service' },
  { pathPrefix: '/v1/orders',        envKey: 'ORDER_SERVICE_URL',        required: false, upstreamName: 'order-service' },
  { pathPrefix: '/v1/dispatch',      envKey: 'DISPATCH_SERVICE_URL',     required: false, upstreamName: 'dispatch-service' },
  { pathPrefix: '/v1/tracking',      envKey: 'TRACKING_SERVICE_URL',     required: false, upstreamName: 'tracking-service' },
  { pathPrefix: '/v1/notifications', envKey: 'NOTIFICATION_SERVICE_URL', required: false, upstreamName: 'notification-service' },
  { pathPrefix: '/v1/ai',            envKey: 'AI_SERVICE_URL',           required: false, upstreamName: 'ai-service' },
];

export function mountProxyRoutes(app: express.Express, env: Env): void {
  for (const r of ROUTES) {
    const target = env[r.envKey] as string | undefined;
    if (!target) {
      if (r.required) throw new Error(`required upstream URL missing: ${r.envKey}`);
      continue;
    }
    mountProxyWithRetry({
      app,
      mountPath: r.pathPrefix,
      target,
      proxyTimeoutMs: env.GATEWAY_PROXY_TIMEOUT_MS,
      retryDelayMs: env.GATEWAY_RETRY_DELAY_MS,
      upstreamName: r.upstreamName,
    });
  }
}
