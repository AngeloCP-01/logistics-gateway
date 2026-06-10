import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I2 authenticated notification golden path', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap({ withNotificationStub: true });
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('forwards GET /v1/notifications with user identity headers', async () => {
    const token = validUserJwt({ sub: 'user-abc', role: 'customer' });
    b.notificationStub!.setHandlers([
      (_req, res) => res.status(200).json({ items: [], nextCursor: null }),
    ]);

    const res = await request(b.server)
      .get('/v1/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });

    const upstream = b.notificationStub!.recordedRequests()[0];
    expect(upstream.method).toBe('GET');
    expect(upstream.path).toBe('/v1/notifications');
    expect(upstream.headers.authorization).toBe(`Bearer ${token}`);
    expect(upstream.headers['x-user-id']).toBe('user-abc');
    expect(upstream.headers['x-user-role']).toBe('customer');
    expect(upstream.headers['x-request-id']).toBe(res.headers['x-request-id']);
    expect(upstream.headers['x-service-id']).toBeUndefined();
  });

  it('forwards POST /v1/notifications/:id/read to the notification-service', async () => {
    const token = validUserJwt({ sub: 'user-abc', role: 'customer' });
    b.notificationStub!.setHandlers([(_req, res) => res.status(204).end()]);

    const res = await request(b.server)
      .post('/v1/notifications/notif-1/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const upstream = b.notificationStub!.recordedRequests()[0];
    expect(upstream.method).toBe('POST');
    expect(upstream.path).toBe('/v1/notifications/notif-1/read');
  });

  it('forwards GET /v1/notifications/preferences to the notification-service', async () => {
    const token = validUserJwt({ sub: 'user-abc', role: 'customer' });
    b.notificationStub!.setHandlers([
      (_req, res) => res.status(200).json({ email: true, push: false }),
    ]);

    const res = await request(b.server)
      .get('/v1/notifications/preferences')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: true, push: false });

    const upstream = b.notificationStub!.recordedRequests()[0];
    expect(upstream.method).toBe('GET');
    expect(upstream.path).toBe('/v1/notifications/preferences');
  });
});
