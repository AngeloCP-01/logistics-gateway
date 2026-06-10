import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I2 authenticated tracking golden path', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap({ withTrackingStub: true });
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  // HTTP pass-through only — the WS upgrade is covered by ws-upgrade.int.test.ts.
  it('forwards GET /v1/tracking/orders/:id/latest with user identity headers', async () => {
    const token = validUserJwt({ sub: 'user-abc', role: 'customer' });
    const orderId = '018f3b2a-1c4d-7e8f-9a0b-1c2d3e4f5a6b';
    b.trackingStub!.setHandlers([
      (_req, res) => res.status(200).json({ lat: 1, lng: 2 }),
    ]);

    const res = await request(b.server)
      .get(`/v1/tracking/orders/${orderId}/latest`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lat: 1, lng: 2 });

    const upstream = b.trackingStub!.recordedRequests()[0];
    expect(upstream.method).toBe('GET');
    expect(upstream.path).toBe(`/v1/tracking/orders/${orderId}/latest`);
    expect(upstream.headers.authorization).toBe(`Bearer ${token}`);
    expect(upstream.headers['x-user-id']).toBe('user-abc');
    expect(upstream.headers['x-user-role']).toBe('customer');
    expect(upstream.headers['x-request-id']).toBe(res.headers['x-request-id']);
    expect(upstream.headers['x-service-id']).toBeUndefined();
  });
});
