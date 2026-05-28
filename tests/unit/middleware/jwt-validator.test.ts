import express, { type Express } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jwtValidatorMiddleware } from '@/middleware/jwt-validator';

const JWT_SECRET = 'user-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SERVICE_JWT_SECRET = 'svc-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeApp(): Express {
  const app = express();
  app.use(jwtValidatorMiddleware({ jwtSecret: JWT_SECRET, serviceJwtSecret: SERVICE_JWT_SECRET }));
  app.get('/identity', (req, res) => {
    res.json({ identity: req.identity ?? null });
  });
  return app;
}

function userToken(opts: Partial<jwt.SignOptions> = {}): string {
  return jwt.sign({ sub: 'user-123', role: 'customer' }, JWT_SECRET, { expiresIn: '15m', ...opts });
}

function serviceToken(opts: Partial<jwt.SignOptions> = {}): string {
  return jwt.sign({ sub: 'svc:dispatch', aud: 'user-service' }, SERVICE_JWT_SECRET, {
    expiresIn: '5m',
    ...opts,
  });
}

describe('jwt-validator', () => {
  describe('no token', () => {
    it('proceeds with null identity', async () => {
      const res = await request(makeApp()).get('/identity');
      expect(res.status).toBe(200);
      expect(res.body.identity).toBeNull();
    });
  });

  describe('valid user JWT', () => {
    it('sets req.identity = { kind: user, sub, role }', async () => {
      const res = await request(makeApp())
        .get('/identity')
        .set('Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.identity).toEqual({ kind: 'user', sub: 'user-123', role: 'customer' });
    });
  });

  describe('valid service JWT', () => {
    it('sets req.identity = { kind: service, svc, aud }', async () => {
      const res = await request(makeApp())
        .get('/identity')
        .set('X-Service-Authorization', `Bearer ${serviceToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.identity).toEqual({ kind: 'service', svc: 'dispatch', aud: 'user-service' });
    });
  });

  describe('invalid user JWT', () => {
    it('401 jwt-malformed for non-JWT shape', async () => {
      const res = await request(makeApp()).get('/identity').set('Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/jwt-malformed$/);
    });

    it('401 jwt-invalid-signature for tampered token', async () => {
      const t = userToken();
      const tampered = t.slice(0, -3) + 'xxx';
      const res = await request(makeApp())
        .get('/identity')
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/jwt-invalid-signature$/);
    });

    it('401 jwt-expired', async () => {
      const t = userToken({ expiresIn: '-1s' });
      const res = await request(makeApp()).get('/identity').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/jwt-expired$/);
    });
  });

  describe('invalid service JWT', () => {
    it('401 service-jwt-malformed', async () => {
      const res = await request(makeApp())
        .get('/identity')
        .set('X-Service-Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/service-jwt-malformed$/);
    });

    it('401 service-jwt-invalid-signature', async () => {
      const t = serviceToken();
      const tampered = t.slice(0, -3) + 'xxx';
      const res = await request(makeApp())
        .get('/identity')
        .set('X-Service-Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/service-jwt-invalid-signature$/);
    });

    it('401 service-jwt-expired', async () => {
      const t = serviceToken({ expiresIn: '-1s' });
      const res = await request(makeApp())
        .get('/identity')
        .set('X-Service-Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/service-jwt-expired$/);
    });
  });

  describe('cross-attack', () => {
    it('user JWT presented in X-Service-Authorization → 401 (invalid signature for service secret)', async () => {
      const res = await request(makeApp())
        .get('/identity')
        .set('X-Service-Authorization', `Bearer ${userToken()}`);
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/service-jwt-invalid-signature$/);
    });

    it('service JWT presented in Authorization → 401 (invalid signature for user secret)', async () => {
      const res = await request(makeApp())
        .get('/identity')
        .set('Authorization', `Bearer ${serviceToken()}`);
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/jwt-invalid-signature$/);
    });
  });

  describe('malformed Authorization header', () => {
    it('401 when Authorization is not "Bearer X.Y.Z"', async () => {
      const res = await request(makeApp()).get('/identity').set('Authorization', 'Basic abc');
      expect(res.status).toBe(401);
      expect(res.body.type).toMatch(/jwt-malformed$/);
    });
  });
});
