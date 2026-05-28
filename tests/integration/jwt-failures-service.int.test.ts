import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validServiceJwt, expiredServiceJwt } from '@tests/helpers/jwt-fixtures';

function tamperedServiceJwt(): string {
  const t = validServiceJwt();
  return t.slice(0, -3) + 'xxx';
}

describe('I5 service JWT failure paths', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  beforeEach(() => {
    // Reset upstream stub state — these tests assert upstream is NEVER called.
    b.userStub!.setHandlers([(_req, res) => res.status(200).json({ should: 'not be called' })]);
  });

  it('401 service-jwt-malformed for non-JWT shape', async () => {
    const res = await request(b.server).get('/v1/users/x').set('X-Service-Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/service-jwt-malformed$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('401 service-jwt-invalid-signature for tampered token', async () => {
    const res = await request(b.server).get('/v1/users/x').set('X-Service-Authorization', `Bearer ${tamperedServiceJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/service-jwt-invalid-signature$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('401 service-jwt-expired for expired token', async () => {
    const res = await request(b.server).get('/v1/users/x').set('X-Service-Authorization', `Bearer ${expiredServiceJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/service-jwt-expired$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('401 service-jwt-malformed when X-Service-Authorization is not Bearer', async () => {
    const res = await request(b.server).get('/v1/users/x').set('X-Service-Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/service-jwt-malformed$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });
});
