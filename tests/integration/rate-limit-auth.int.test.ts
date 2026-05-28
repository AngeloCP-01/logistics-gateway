import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I8 rate-limit authenticated', () => {
  let b: Bootstrap;
  const token = validUserJwt({ sub: 'rate-user' });

  beforeAll(async () => {
    b = await bootstrap({
      envOverrides: {
        GATEWAY_AUTH_RPM: '5',
        GATEWAY_RATE_LIMIT_WINDOW_MS: '2000',
      },
    });
    b.userStub!.setHandlers([(_req, res) => res.status(200).json({ ok: true })]);
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('429s after 5 authenticated requests by the same user', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(b.server)
        .get('/v1/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(200);
    }
    const denied = await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${token}`);
    expect(denied.status).toBe(429);
    expect(denied.body.type).toMatch(/rate-limited$/);
  });
});
