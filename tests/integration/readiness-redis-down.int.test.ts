import request from 'supertest';
import { bootstrap, type Bootstrap } from '@tests/helpers/bootstrap';

describe('I16 readiness Redis-down', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    // redisInfo already stopped during the test. b.close() may try to stop again — guard.
    try {
      await b.close();
    } catch {
      /* ignore — already torn down */
    }
  });

  it('returns 503 from /readyz when Redis is unreachable; /healthz unaffected', async () => {
    // Sanity: healthy first.
    expect((await request(b.server).get('/readyz')).status).toBe(200);
    expect((await request(b.server).get('/healthz')).status).toBe(200);

    // Stop the Redis container — readiness depends on it.
    await b.redisInfo.stop();

    // Allow ioredis a moment to notice the disconnect.
    await new Promise((r) => setTimeout(r, 500));

    const ready = await request(b.server).get('/readyz');
    expect(ready.status).toBe(503);
    expect(ready.body.type).toMatch(/not-ready$/);

    // Liveness is decoupled — process is up.
    const alive = await request(b.server).get('/healthz');
    expect(alive.status).toBe(200);
  });
});
