import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';

describe('I11 no retry on POST 5xx', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('forwards POST 5xx without retry', async () => {
    let calls = 0;
    b.authStub!.setHandlers([
      (_req, res) => {
        calls += 1;
        res.status(502).end('bad');
      },
    ]);

    const res = await request(b.server)
      .post('/v1/auth/login')
      .send({ email: 'a@b.c', password: 'pw' });

    expect(res.status).toBe(502);
    expect(calls).toBe(1);
  });
});
