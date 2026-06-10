import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { errorMapper, GatewayError } from '@/middleware/error-mapper';

function makeApp(thrown: unknown): Express {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'req-id';
    next();
  });
  app.get('/boom', (_req, _res, next) => next(thrown));
  app.use(errorMapper({ problemTypeBase: '/problems' }));
  return app;
}

describe('error-mapper', () => {
  it('maps a known GatewayError to the declared status + slug', async () => {
    const res = await request(makeApp(new GatewayError(502, 'upstream-unavailable', 'Upstream is down'))).get('/boom');
    expect(res.status).toBe(502);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: '/problems/upstream-unavailable',
      title: 'Upstream is down',
      status: 502,
      requestId: 'req-id',
    });
  });

  it('maps an unknown error to a generic 500 in production WITHOUT leaking the cause', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const err = new Error('database password: hunter2');
      err.stack = 'Error: database password: hunter2\n  at /secret/path/file.ts:42';
      const res = await request(makeApp(err)).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        type: '/problems/internal-error',
        title: 'Internal Server Error',
        status: 500,
        requestId: 'req-id',
      });
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
      expect(JSON.stringify(res.body)).not.toContain('/secret/');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('surfaces the cause in the 500 body outside production (conventions §8.2)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const err = new Error('boom upstream');
      const res = await request(makeApp(err)).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        type: '/problems/internal-error',
        title: 'Internal Server Error',
        status: 500,
        requestId: 'req-id',
        detail: 'boom upstream',
        errorName: 'Error',
      });
      expect(Array.isArray(res.body.stack)).toBe(true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
