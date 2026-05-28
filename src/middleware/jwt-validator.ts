import type { RequestHandler, Request, Response, NextFunction } from 'express';
import jwt, { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

export type Identity =
  | { kind: 'user'; sub: string; role: string }
  | { kind: 'service'; svc: string; aud: string };

// Augment Express.Request with identity. Same module-augmentation pattern as
// request-id.ts so the request lifecycle types stay consistent across middleware.
declare module 'express-serve-static-core' {
  interface Request {
    identity?: Identity | null;
  }
}

export interface JwtValidatorOptions {
  jwtSecret: string;
  serviceJwtSecret: string;
  problemTypeBase?: string;
}

type ErrorKind = 'malformed' | 'expired' | 'invalid-signature';

function send401(
  res: Response,
  slug: string,
  title: string,
  requestId: string,
  problemTypeBase: string,
): void {
  res.status(401).setHeader('Content-Type', 'application/problem+json');
  res.json({
    type: `${problemTypeBase}/${slug}`,
    title,
    status: 401,
    requestId,
  });
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer (.+)$/.exec(header);
  return m ? m[1] : null;
}

function classifyJwtError(err: unknown): ErrorKind {
  if (err instanceof TokenExpiredError) return 'expired';
  if (err instanceof JsonWebTokenError) {
    if (/jwt malformed|jwt must be provided|invalid token/i.test(err.message)) return 'malformed';
    return 'invalid-signature';
  }
  return 'malformed';
}

export function jwtValidatorMiddleware(opts: JwtValidatorOptions): RequestHandler {
  const problemTypeBase = opts.problemTypeBase ?? '/problems';

  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = req.requestId ?? '';
    const authHeader = req.headers.authorization;
    const svcAuthHeader = req.headers['x-service-authorization'];
    const svcAuthSingle = Array.isArray(svcAuthHeader) ? svcAuthHeader[0] : svcAuthHeader;

    if (authHeader) {
      const token = extractBearer(authHeader);
      if (!token) {
        send401(res, 'jwt-malformed', 'Malformed authorization header', requestId, problemTypeBase);
        return;
      }
      try {
        const payload = jwt.verify(token, opts.jwtSecret) as jwt.JwtPayload;
        if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
          send401(res, 'jwt-malformed', 'Missing required claims', requestId, problemTypeBase);
          return;
        }
        req.identity = { kind: 'user', sub: payload.sub, role: payload.role };
        next();
        return;
      } catch (err) {
        const kind = classifyJwtError(err);
        send401(res, `jwt-${kind}`, `User token ${kind}`, requestId, problemTypeBase);
        return;
      }
    }

    if (svcAuthSingle) {
      const token = extractBearer(svcAuthSingle);
      if (!token) {
        send401(
          res,
          'service-jwt-malformed',
          'Malformed service authorization header',
          requestId,
          problemTypeBase,
        );
        return;
      }
      try {
        const payload = jwt.verify(token, opts.serviceJwtSecret) as jwt.JwtPayload;
        const sub = payload.sub;
        const aud = payload.aud;
        if (
          typeof sub !== 'string' ||
          !sub.startsWith('svc:') ||
          typeof aud !== 'string'
        ) {
          send401(
            res,
            'service-jwt-malformed',
            'Missing required claims',
            requestId,
            problemTypeBase,
          );
          return;
        }
        req.identity = { kind: 'service', svc: sub.slice(4), aud };
        next();
        return;
      } catch (err) {
        const kind = classifyJwtError(err);
        send401(res, `service-jwt-${kind}`, `Service token ${kind}`, requestId, problemTypeBase);
        return;
      }
    }

    req.identity = null;
    next();
  };
}
