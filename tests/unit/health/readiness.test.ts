import express from 'express';
import request from 'supertest';
import { readinessHandler } from '@/health/readiness';

function makeApp(redis: { ping: () => Promise<string> }) {
  const app = express();
  app.get('/readyz', readinessHandler({ redis, timeoutMs: 100 }));
  return app;
}

describe('readiness', () => {
  it('200 when redis PING succeeds within timeout', async () => {
    const redis = { ping: jest.fn().mockResolvedValue('PONG') };
    const res = await request(makeApp(redis)).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('503 when redis PING fails', async () => {
    const redis = { ping: jest.fn().mockRejectedValue(new Error('refused')) };
    const res = await request(makeApp(redis)).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body.type).toMatch(/not-ready$/);
  });

  it('503 when redis PING exceeds timeout', async () => {
    const redis = { ping: () => new Promise<string>((r) => setTimeout(() => r('PONG'), 500)) };
    const res = await request(makeApp(redis)).get('/readyz');
    expect(res.status).toBe(503);
  });
});
