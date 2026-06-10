import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I2 authenticated order golden path', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap({ withOrderStub: true });
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('forwards GET /v1/orders/me with user identity headers', async () => {
    const token = validUserJwt({ sub: 'user-abc', role: 'customer' });
    b.orderStub!.setHandlers([
      (_req, res) => res.status(200).json({ items: [], nextCursor: null }),
    ]);

    const res = await request(b.server)
      .get('/v1/orders/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });

    const upstream = b.orderStub!.recordedRequests()[0];
    expect(upstream.method).toBe('GET');
    expect(upstream.path).toBe('/v1/orders/me');
    expect(upstream.headers.authorization).toBe(`Bearer ${token}`);
    expect(upstream.headers['x-user-id']).toBe('user-abc');
    expect(upstream.headers['x-user-role']).toBe('customer');
    expect(upstream.headers['x-request-id']).toBe(res.headers['x-request-id']);
    expect(upstream.headers['x-service-id']).toBeUndefined();
  });
});
