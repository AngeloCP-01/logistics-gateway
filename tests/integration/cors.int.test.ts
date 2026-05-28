import request from 'supertest';
import { bootstrap, type Bootstrap } from '@tests/helpers/bootstrap';

describe('I17 CORS allow-list', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000); // default CORS origins = http://localhost:3000

  afterAll(async () => {
    await b.close();
  });

  it('returns Access-Control-Allow-Origin for an allow-listed Origin on OPTIONS preflight', async () => {
    const res = await request(b.server)
      .options('/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect([200, 204]).toContain(res.status); // cors middleware uses 204 by default; some configs 200
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('omits ACAO for a disallowed Origin', async () => {
    const res = await request(b.server)
      .options('/v1/auth/login')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
