import Redis, { RedisOptions } from 'ioredis';

export type RedisClient = Redis;

export function createRedisClient(url: string, options: RedisOptions = {}): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    ...options,
  });
}
