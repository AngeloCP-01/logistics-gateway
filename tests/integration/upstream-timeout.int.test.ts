import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I12 upstream timeout', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap({
      envOverrides: { GATEWAY_PROXY_TIMEOUT_MS: '1000', GATEWAY_RETRY_DELAY_MS: '50' },
    });
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('returns 504 upstream-timeout when stub never responds', async () => {
    b.userStub!.setHandlers([(_req, _res) => { /* never writes */ }]);

    const start = Date.now();
    const res = await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${validUserJwt()}`)
      .timeout({ deadline: 30_000 });
    const elapsed = Date.now() - start;

    expect(res.status).toBe(504);
    expect(res.body.type).toMatch(/upstream-timeout$/);
    // GET retries once: at least 1 proxyTimeout elapsed (lower bound 900ms to
    // allow for OS scheduling jitter).
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(10_000);
  });
});
