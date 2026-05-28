import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { expiredUserJwt, tamperedUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I4 user JWT failure paths', () => {
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

  it('401 jwt-malformed for non-JWT shape', async () => {
    const res = await request(b.server).get('/v1/users/me').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.type).toMatch(/jwt-malformed$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('401 jwt-invalid-signature for tampered token', async () => {
    const res = await request(b.server).get('/v1/users/me').set('Authorization', `Bearer ${tamperedUserJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/jwt-invalid-signature$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('401 jwt-expired for expired token', async () => {
    const res = await request(b.server).get('/v1/users/me').set('Authorization', `Bearer ${expiredUserJwt()}`);
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/jwt-expired$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });

  it('401 jwt-malformed when Authorization is not Bearer', async () => {
    const res = await request(b.server).get('/v1/users/me').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/jwt-malformed$/);
    expect(b.userStub!.recordedRequests()).toHaveLength(0);
  });
});
