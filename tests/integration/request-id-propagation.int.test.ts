import request from 'supertest';
import { bootstrap, type Bootstrap } from '@tests/helpers/bootstrap';

describe('I18 X-Request-Id propagation', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  beforeEach(() => {
    b.authStub!.setHandlers([(_req, res) => res.status(200).json({ ok: true })]);
  });

  it('honors a well-formed inbound X-Request-Id end-to-end', async () => {
    const inbound = '01934d3e-2b3c-7000-8000-abc123def456';
    const res = await request(b.server)
      .post('/v1/auth/login')
      .set('X-Request-Id', inbound)
      .send({ email: 'a@b.c', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(inbound);
    expect(b.authStub!.recordedRequests()[0].headers['x-request-id']).toBe(inbound);
  });

  it('replaces a malformed inbound X-Request-Id with a fresh value', async () => {
    const malformed = 'has spaces';
    const res = await request(b.server)
      .post('/v1/auth/login')
      .set('X-Request-Id', malformed)
      .send({ email: 'a@b.c', password: 'pw' });
    expect(res.headers['x-request-id']).not.toBe(malformed);
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // The auth stub should see the gateway-generated id (same as response header)
    expect(b.authStub!.recordedRequests()[0].headers['x-request-id']).toBe(res.headers['x-request-id']);
  });

  it('generates a fresh X-Request-Id when none is provided', async () => {
    const res = await request(b.server)
      .post('/v1/auth/login')
      .send({ email: 'a@b.c', password: 'pw' });
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(b.authStub!.recordedRequests()[0].headers['x-request-id']).toBe(res.headers['x-request-id']);
  });
});
