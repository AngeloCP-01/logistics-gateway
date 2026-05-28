import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I10 retry on GET 5xx', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('retries GET once when upstream returns 5xx then 200', async () => {
    let calls = 0;
    b.userStub!.setHandlers([
      (_req, res) => {
        calls += 1;
        res.status(502).end('bad');
      },
      (_req, res) => {
        calls += 1;
        res.status(200).json({ ok: true });
      },
    ]);

    const res = await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${validUserJwt()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
