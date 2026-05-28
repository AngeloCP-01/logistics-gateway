import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';

let container: StartedRedisContainer | null = null;

export async function startRedis(): Promise<{ url: string; stop: () => Promise<void> }> {
  container = await new RedisContainer('redis:7-alpine').start();
  return {
    url: container.getConnectionUrl(),
    stop: async () => {
      await container?.stop();
      container = null;
    },
  };
}
