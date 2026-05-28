import express from 'express';
import request from 'supertest';
import { rateLimiterMiddleware, type RateLimitStore } from '@/middleware/rate-limiter';

class FakeStore implements RateLimitStore {
  private calls: Array<{ key: string; limit: number; windowMs: number }> = [];
  constructor(
    private allowed: boolean,
    private retryAfter = 1,
  ) {}
  recordedCalls() {
    return this.calls;
  }
  async tryConsume(key: string, limit: number, windowMs: number) {
    this.calls.push({ key, limit, windowMs });
    return this.allowed
      ? { allowed: true as const }
      : { allowed: false as const, retryAfterSeconds: this.retryAfter };
  }
}

function makeApp(store: RateLimitStore, identityKind: 'user' | 'service' | null) {
  const app = express();
  app.use((req, _res, next) => {
    if (identityKind === 'user') req.identity = { kind: 'user', sub: 'user-1', role: 'customer' };
    else if (identityKind === 'service')
      req.identity = { kind: 'service', svc: 'dispatch', aud: 'user-service' };
    else req.identity = null;
    req.requestId = 'req-id';
    next();
  });
  app.use(rateLimiterMiddleware({ store, anonRpm: 60, authRpm: 300, windowMs: 60000 }));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('rate-limiter', () => {
  it('skips when identity.kind === service', async () => {
    const store = new FakeStore(false);
    const res = await request(makeApp(store, 'service')).get('/ping');
    expect(res.status).toBe(200);
    expect(store.recordedCalls()).toEqual([]);
  });

  it('uses user bucket for authenticated requests at 300 rpm', async () => {
    const store = new FakeStore(true);
    await request(makeApp(store, 'user')).get('/ping');
    expect(store.recordedCalls()).toEqual([{ key: 'user:user-1', limit: 300, windowMs: 60000 }]);
  });

  it('uses ip bucket for anonymous requests at 60 rpm', async () => {
    const store = new FakeStore(true);
    await request(makeApp(store, null)).get('/ping').set('X-Forwarded-For', '203.0.113.1');
    const calls = store.recordedCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].limit).toBe(60);
    expect(calls[0].key).toMatch(/^ip:/);
  });

  it('returns 429 with Retry-After when store rejects', async () => {
    const store = new FakeStore(false, 12);
    const res = await request(makeApp(store, null)).get('/ping');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('12');
    expect(res.body.type).toMatch(/rate-limited$/);
    expect(res.body.retryAfter).toBe(12);
  });
});
