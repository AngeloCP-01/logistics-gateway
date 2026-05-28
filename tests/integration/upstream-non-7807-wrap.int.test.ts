import type { Response as ExpressResponse } from 'express';
import request from 'supertest';

import { bootstrap } from '@tests/helpers/bootstrap';
import type { Bootstrap } from '@tests/helpers/bootstrap';
import { validUserJwt } from '@tests/helpers/jwt-fixtures';

describe('I15 upstream non-7807 wrap', () => {
  let b: Bootstrap;

  beforeAll(async () => {
    b = await bootstrap();
  }, 60_000);

  afterAll(async () => {
    await b.close();
  });

  it('wraps non-7807 5xx with detail truncated to 256 chars and newlines stripped', async () => {
    const longBody = 'x'.repeat(500) + '\nnewline-should-be-stripped\rcr-too';
    const respond = (_req: unknown, res: ExpressResponse) => {
      res.status(503).setHeader('Content-Type', 'text/plain').end(longBody);
    };
    // Both calls must fail so the retry doesn't mask the wrap behavior.
    b.userStub!.setHandlers([respond, respond]);

    const res = await request(b.server)
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${validUserJwt()}`);

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body.type).toMatch(/upstream-error$/);
    expect(res.body.title).toBe('Upstream service error');
    expect(res.body.status).toBe(503);
    expect(res.body.instance).toBe('/v1/users/me');
    expect(res.body.upstream).toBe('user-service');
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);

    expect(typeof res.body.detail).toBe('string');
    expect(res.body.detail.length).toBeLessThanOrEqual(256);
    expect(res.body.detail).not.toContain('\n');
    expect(res.body.detail).not.toContain('\r');
  });
});
