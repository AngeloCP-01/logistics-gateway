import type { RequestHandler, Request, Response, NextFunction } from 'express';

export interface RateLimitStore {
  tryConsume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
}

export interface RateLimiterOptions {
  store: RateLimitStore;
  anonRpm: number;
  authRpm: number;
  windowMs: number;
  problemTypeBase?: string;
}

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(',')[0].trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function rateLimiterMiddleware(opts: RateLimiterOptions): RequestHandler {
  const problemTypeBase = opts.problemTypeBase ?? '/problems';

  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.identity?.kind === 'service') {
      next();
      return;
    }

    const key =
      req.identity?.kind === 'user' ? `user:${req.identity.sub}` : `ip:${clientIp(req)}`;
    const limit = req.identity?.kind === 'user' ? opts.authRpm : opts.anonRpm;

    let result;
    try {
      result = await opts.store.tryConsume(key, limit, opts.windowMs);
    } catch (err) {
      next(err);
      return;
    }

    if (result.allowed) {
      next();
      return;
    }

    res
      .status(429)
      .setHeader('Retry-After', String(result.retryAfterSeconds))
      .setHeader('Content-Type', 'application/problem+json')
      .json({
        type: `${problemTypeBase}/rate-limited`,
        title: 'Rate limit exceeded',
        status: 429,
        retryAfter: result.retryAfterSeconds,
        requestId: req.requestId,
      });
  };
}
