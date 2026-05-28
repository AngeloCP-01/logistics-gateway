import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validServiceJwt } from '@tests/helpers/jwt-fixtures';

describe('I9 rate-limit service exempt', () => {
  let b: Bootstrap;
  const svcToken = validServiceJwt({ svc: 'dispatch', aud: 'user-service' });

  beforeAll(async () => {
    b = await bootstrap({
      envOverrides: {
        GATEWAY_ANON_RPM: '5',
        GATEWAY_AUTH_RPM: '5',
        GATEWAY_RATE_LIMIT_WINDOW_MS: '2000',
      },
    });
    b.userStub!.setHandlers([(_req, res) => res.status(200).json({ ok: true })]);
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('does not 429 service-to-service requests beyond the per-user limit', async () => {
    // 50 calls — far exceeding the 5-per-window limit; all should succeed.
    for (let i = 0; i < 50; i++) {
      const r = await request(b.server)
        .get('/v1/users/x')
        .set('X-Service-Authorization', `Bearer ${svcToken}`);
      expect(r.status).toBe(200);
    }
  });
});
