import request from 'supertest';
import { bootstrap, type Bootstrap } from '@tests/helpers/bootstrap';

describe('I21 graceful shutdown', () => {
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

  it('responds 503 shutting-down to new requests after the drain flag is set, with Connection: close', async () => {
    // Normal first
    const ok = await request(b.server).post('/v1/auth/login').send({});
    expect(ok.status).toBe(200);

    // Flip the drain flag
    b.setShuttingDown(true);

    const drained = await request(b.server).post('/v1/auth/login').send({});
    expect(drained.status).toBe(503);
    expect(drained.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(drained.headers['connection']).toBe('close');
    expect(drained.body.type).toMatch(/shutting-down$/);

    // Health endpoints still respond 200 (drain gate is placed AFTER health)
    expect((await request(b.server).get('/healthz')).status).toBe(200);
    expect((await request(b.server).get('/readyz')).status).toBe(200);

    // Reset for any later tests in this suite (none, but safe)
    b.setShuttingDown(false);
  });
});
