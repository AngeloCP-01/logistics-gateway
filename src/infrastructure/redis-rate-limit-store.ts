import type { RedisClient } from './redis';
import type { RateLimitStore } from '@/middleware/rate-limiter';

/**
 * Sliding-window rate limiter using a Redis sorted-set.
 * Each request appends `now` as a score; expired entries are pruned by score.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisClient) {}

  async tryConsume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}:${Math.random()}`;

    const multi = this.redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zadd(key, now, member);
    multi.zcard(key);
    multi.pexpire(key, windowMs);

    const res = await multi.exec();
    if (!res) throw new Error('redis pipeline returned null');

    const count = res[2][1] as number;
    if (count <= limit) return { allowed: true } as const;

    // Determine retry-after by inspecting the oldest entry in the window
    const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
    const oldestScore = oldest.length === 2 ? Number(oldest[1]) : windowStart;
    const retryAfterMs = Math.max(0, oldestScore + windowMs - now);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    } as const;
  }
}
