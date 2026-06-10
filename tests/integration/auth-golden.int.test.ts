import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I2 auth golden path', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  // /v1/auth/* is public at the gateway (register/login are where you obtain a token);
  // the JWT validator never *requires* a bearer here. This proves the unauthenticated
  // pass-through forwards the full /v1/auth/... path.
  it('forwards POST /v1/auth/login without a bearer token', async () => {
    b.authStub!.setHandlers([
      (_req, res) => res.status(201).json({ accessToken: 'x', refreshToken: 'y' }),
    ]);

    const res = await request(b.server)
      .post('/v1/auth/login')
      .send({ email: 'a@b.c', password: 'pw' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ accessToken: 'x', refreshToken: 'y' });

    const upstream = b.authStub!.recordedRequests()[0];
    expect(upstream.method).toBe('POST');
    expect(upstream.path).toBe('/v1/auth/login');
    expect(upstream.headers['x-request-id']).toBe(res.headers['x-request-id']);
    expect(upstream.headers.authorization).toBeUndefined();
    expect(upstream.headers['x-user-id']).toBeUndefined();
    expect(upstream.headers['x-service-id']).toBeUndefined();
  });

  // When a bearer *is* present (e.g. GET /v1/auth/me), the gateway validates it and
  // forwards both the full path and the user-identity headers.
  it('forwards GET /v1/auth/me with user identity headers', async () => {
    const token = validUserJwt({ sub: 'user-abc', role: 'customer' });
    b.authStub!.setHandlers([
      (_req, res) => res.status(200).json({ id: 'user-abc', email: 'a@b.c' }),
    ]);

    const res = await request(b.server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'user-abc', email: 'a@b.c' });

    const upstream = b.authStub!.recordedRequests()[0];
    expect(upstream.method).toBe('GET');
    expect(upstream.path).toBe('/v1/auth/me');
    expect(upstream.headers.authorization).toBe(`Bearer ${token}`);
    expect(upstream.headers['x-user-id']).toBe('user-abc');
    expect(upstream.headers['x-user-role']).toBe('customer');
    expect(upstream.headers['x-request-id']).toBe(res.headers['x-request-id']);
    expect(upstream.headers['x-service-id']).toBeUndefined();
  });
});
