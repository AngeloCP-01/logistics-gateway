import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';

describe('I7 rate-limit anonymous', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap({
      envOverrides: {
        GATEWAY_ANON_RPM: '5',
        GATEWAY_RATE_LIMIT_WINDOW_MS: '2000',
      },
    });
    // auth-stub always 200
    b.authStub!.setHandlers([(_req, res) => res.status(200).json({ ok: true })]);
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('429s after 5 anonymous requests in window', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(b.server)
        .get('/v1/auth/anything')
        .set('X-Forwarded-For', '203.0.113.1');
      expect(r.status).toBe(200);
    }
    const denied = await request(b.server)
      .get('/v1/auth/anything')
      .set('X-Forwarded-For', '203.0.113.1');
    expect(denied.status).toBe(429);
    expect(denied.headers['retry-after']).toMatch(/^\d+$/);
    expect(denied.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(denied.body.type).toMatch(/rate-limited$/);
    expect(typeof denied.body.retryAfter).toBe('number');
    expect(denied.body.retryAfter).toBeGreaterThanOrEqual(1);
  });
});
