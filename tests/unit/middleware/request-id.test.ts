import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { requestIdMiddleware } from '@/middleware/request-id';

function makeApp(): Express {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/echo', (req, res) => res.json({ requestId: req.requestId }));
  return app;
}

describe('request-id middleware', () => {
  it('generates a UUID v7 when no inbound X-Request-Id', async () => {
    const res = await request(makeApp()).get('/echo');
    expect(res.body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('honors a well-formed inbound X-Request-Id', async () => {
    const inbound = '01934d3e-2b3c-7000-8000-abc123def456';
    const res = await request(makeApp()).get('/echo').set('X-Request-Id', inbound);
    expect(res.body.requestId).toBe(inbound);
    expect(res.headers['x-request-id']).toBe(inbound);
  });

  it('honors an opaque trace-style inbound id matching the pattern', async () => {
    const inbound = 'trace-abc_123-XYZ';
    const res = await request(makeApp()).get('/echo').set('X-Request-Id', inbound);
    expect(res.body.requestId).toBe(inbound);
  });

  it('replaces a malformed inbound X-Request-Id with a fresh one', async () => {
    const malformed = 'has spaces and / slashes!';
    const res = await request(makeApp()).get('/echo').set('X-Request-Id', malformed);
    expect(res.body.requestId).not.toBe(malformed);
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('replaces an over-long inbound id', async () => {
    const overlong = 'a'.repeat(65);
    const res = await request(makeApp()).get('/echo').set('X-Request-Id', overlong);
    expect(res.body.requestId).not.toBe(overlong);
  });
});
