import type { Response as ExpressResponse } from 'express';
import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I14 upstream 7807 passthrough', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('passes through upstream application/problem+json with requestId overwritten', async () => {
    const upstreamBody = {
      type: 'https://upstream.example/problems/db-down',
      title: 'DB down',
      status: 503,
      detail: 'database connection pool exhausted',
      instance: '/internal/op',
      requestId: 'upstream-own-id',
    };
    const respond = (_req: unknown, res: ExpressResponse) => {
      res
        .status(503)
        .setHeader('Content-Type', 'application/problem+json')
        .end(JSON.stringify(upstreamBody));
    };
    // Both the first call and the retry return the same 7807 — without this,
    // the retry would succeed and our assertions wouldn't run.
    b.userStub!.setHandlers([respond, respond]);

    const res = await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${validUserJwt()}`);

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.type).toBe('https://upstream.example/problems/db-down');
    expect(res.body.title).toBe('DB down');
    expect(res.body.status).toBe(503);
    expect(res.body.detail).toBe('database connection pool exhausted');
    expect(res.body.instance).toBe('/internal/op');
    // requestId must be the gateway's, not the upstream-own-id
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(res.body.requestId).not.toBe('upstream-own-id');
  });
});
