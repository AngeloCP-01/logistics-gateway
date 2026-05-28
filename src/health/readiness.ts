import type { RequestHandler } from 'express';

interface RedisLike {
  ping(): Promise<string>;
}

export function readinessHandler(opts: { redis: RedisLike; timeoutMs: number; problemTypeBase?: string }): RequestHandler {
  const problemTypeBase = opts.problemTypeBase ?? '/problems';
  return async (_req, res) => {
    const timer = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error('redis ping timeout')), opts.timeoutMs),
    );
    try {
      const pong = await Promise.race([opts.redis.ping(), timer]);
      if (pong === 'PONG') {
        res.status(200).json({ status: 'ready' });
        return;
      }
      throw new Error(`unexpected ping response: ${pong}`);
    } catch {
      res.status(503).setHeader('Content-Type', 'application/problem+json').json({
        type: `${problemTypeBase}/not-ready`,
        title: 'Service not ready',
        status: 503,
      });
    }
  };
}
