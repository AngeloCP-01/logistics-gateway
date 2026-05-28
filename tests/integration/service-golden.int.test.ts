import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validServiceJwt } from '@tests/helpers/jwt-fixtures';

describe('I3 service-to-service golden path', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('forwards GET /v1/users/<id> with service identity', async () => {
    const svcToken = validServiceJwt({ svc: 'dispatch', aud: 'user-service' });
    b.userStub!.setHandlers([(_req, res) => res.status(200).json({ id: 'driver-1' })]);

    const res = await request(b.server)
      .get('/v1/users/driver-1')
      .set('X-Service-Authorization', `Bearer ${svcToken}`)
      .set('X-On-Behalf-Of-User-Id', 'orig-user');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'driver-1' });

    const upstream = b.userStub!.recordedRequests()[0];
    expect(upstream.method).toBe('GET');
    // Mount-point prefix is stripped by Express before the proxy forwards (see I1).
    expect(upstream.path).toBe('/driver-1');
    expect(upstream.headers['x-service-authorization']).toBe(`Bearer ${svcToken}`);
    expect(upstream.headers['x-service-id']).toBe('dispatch');
    expect(upstream.headers['x-on-behalf-of-user-id']).toBe('orig-user');
    expect(upstream.headers['x-request-id']).toBe(res.headers['x-request-id']);
    expect(upstream.headers.authorization).toBeUndefined();
    expect(upstream.headers['x-user-id']).toBeUndefined();
  });
});
