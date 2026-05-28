import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';

export const JWT_SECRET: string = 'test-user-secret-aaaaaaaaaaaaaaaaaaaaa';
export const SERVICE_JWT_SECRET: string = 'test-service-secret-bbbbbbbbbbbbbbbbb';

if (JWT_SECRET === SERVICE_JWT_SECRET) throw new Error('test secrets must differ');

export function validUserJwt(
  overrides: Partial<{ sub: string; role: string; expiresIn: string }> = {},
): string {
  return jwt.sign(
    { sub: overrides.sub ?? 'user-123', role: overrides.role ?? 'customer' },
    JWT_SECRET,
    { expiresIn: overrides.expiresIn ?? '15m' } as SignOptions,
  );
}

export function expiredUserJwt(): string {
  return validUserJwt({ expiresIn: '-1s' });
}

export function tamperedUserJwt(): string {
  const t = validUserJwt();
  return t.slice(0, -3) + 'xxx';
}

export function validServiceJwt(
  overrides: Partial<{ svc: string; aud: string; expiresIn: string }> = {},
): string {
  return jwt.sign(
    { sub: `svc:${overrides.svc ?? 'dispatch'}`, aud: overrides.aud ?? 'user-service' },
    SERVICE_JWT_SECRET,
    { expiresIn: overrides.expiresIn ?? '5m' } as SignOptions,
  );
}

export function expiredServiceJwt(): string {
  return validServiceJwt({ expiresIn: '-1s' });
}
