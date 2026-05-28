import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt, validServiceJwt } from '@tests/helpers/jwt-fixtures';

describe('I6 JWT cross-attack defense', () => {
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

  it('rejects user-JWT in X-Service-Authorization with 401 service-jwt-invalid-signature', async () => {
    const res = await request(b.server)
      .get('/v1/users/me')
      .set('X-Service-Authorization', `Bearer ${validUserJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/service-jwt-invalid-signature$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('rejects service-JWT in Authorization with 401 jwt-invalid-signature', async () => {
    const res = await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${validServiceJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/jwt-invalid-signature$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });
});
