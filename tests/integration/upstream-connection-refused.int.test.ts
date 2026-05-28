import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';

describe('I13 upstream connection refused', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap({ authServiceUrl: 'http://127.0.0.1:1' });
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('returns 502 upstream-unavailable when target is closed (POST = no retry)', async () => {
    const res = await request(b.server)
      .post('/v1/auth/login')
      .send({});

    expect(res.status).toBe(502);
    expect(res.body.type).toMatch(/upstream-unavailable$/);
  });
});
