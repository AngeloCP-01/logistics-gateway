import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import type { Logger } from 'pino';

import type { Env } from './config/env.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { jwtValidatorMiddleware } from './middleware/jwt-validator.js';
import { rateLimiterMiddleware } from './middleware/rate-limiter.js';
import type { RateLimitStore } from './middleware/rate-limiter.js';
import { errorMapper } from './middleware/error-mapper.js';
import { livenessHandler } from './health/liveness.js';
import { readinessHandler } from './health/readiness.js';
import { mountProxyRoutes } from './proxy/routes.js';
import { createHttpLogger } from './infrastructure/logger.js';

export interface AppDeps {
  env: Env;
  logger: Logger;
  rateLimitStore: RateLimitStore;
  redis: { ping(): Promise<string> };
  /**
   * Accessor for the "are we draining?" flag. The composition root flips this on SIGTERM.
   * Returning true causes the gateway to reply 503 to all non-health requests.
   */
  shuttingDown: () => boolean;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(requestIdMiddleware);
  app.use(createHttpLogger(deps.logger));
  app.use(helmet());
  app.use(
    cors({
      origin: deps.env.GATEWAY_CORS_ORIGINS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: false,
    }),
  );
  app.use(compression());

  // Health endpoints — registered BEFORE the drain gate so liveness/readiness probes
  // continue to succeed during shutdown. Render's load balancer removes the instance
  // from the pool when /readyz fails; keeping /healthz green during drain lets the LB
  // distinguish "draining" from "dead."
  app.get('/healthz', livenessHandler);
  app.get('/readyz', readinessHandler({ redis: deps.redis, timeoutMs: 200 }));

  // Drain gate — any user-traffic path during shutdown returns 503. Mounted AFTER the
  // health endpoints (so they keep working) but BEFORE the JWT validator (so anonymous
  // traffic is also short-circuited cleanly).
  app.use((req, res, next) => {
    if (!deps.shuttingDown()) {
      next();
      return;
    }
    res
      .status(503)
      .setHeader('Content-Type', 'application/problem+json')
      .setHeader('Connection', 'close')
      .json({
        type: '/problems/shutting-down',
        title: 'Service Shutting Down',
        status: 503,
        requestId: req.requestId,
      });
  });

  app.use(
    jwtValidatorMiddleware({
      jwtSecret: deps.env.JWT_SECRET,
      serviceJwtSecret: deps.env.SERVICE_JWT_SECRET,
    }),
  );

  app.use(
    rateLimiterMiddleware({
      store: deps.rateLimitStore,
      anonRpm: deps.env.GATEWAY_ANON_RPM,
      authRpm: deps.env.GATEWAY_AUTH_RPM,
      windowMs: deps.env.GATEWAY_RATE_LIMIT_WINDOW_MS,
    }),
  );

  mountProxyRoutes(app, deps.env);

  // Catch-all 404 for paths that didn't match a proxy route.
  app.use((req, res) => {
    res
      .status(404)
      .setHeader('Content-Type', 'application/problem+json')
      .json({
        type: '/problems/not-found',
        title: 'Not Found',
        status: 404,
        instance: req.originalUrl,
        requestId: req.requestId,
      });
  });

  app.use(errorMapper({ problemTypeBase: '/problems' }));

  return app;
}
