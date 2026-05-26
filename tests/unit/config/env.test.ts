import { loadEnv } from '@/config/env';

const baseEnv = {
  NODE_ENV: 'test',
  GATEWAY_PORT: '8080',
  JWT_SECRET: 'a'.repeat(32),
  SERVICE_JWT_SECRET: 'b'.repeat(32),
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SERVICE_URL: 'http://auth:8080',
  USER_SERVICE_URL: 'http://user:8080',
  GATEWAY_CORS_ORIGINS: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('parses a fully-specified env with defaults applied', () => {
    const env = loadEnv(baseEnv);
    expect(env.NODE_ENV).toBe('test');
    expect(env.GATEWAY_PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.GATEWAY_PROXY_TIMEOUT_MS).toBe(10000);
    expect(env.GATEWAY_RETRY_DELAY_MS).toBe(250);
    expect(env.GATEWAY_ANON_RPM).toBe(60);
    expect(env.GATEWAY_AUTH_RPM).toBe(300);
    expect(env.GATEWAY_RATE_LIMIT_WINDOW_MS).toBe(60000);
    expect(env.GATEWAY_SHUTDOWN_GRACE_MS).toBe(10000);
    expect(env.GATEWAY_CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('throws when JWT_SECRET equals SERVICE_JWT_SECRET', () => {
    expect(() =>
      loadEnv({ ...baseEnv, SERVICE_JWT_SECRET: 'a'.repeat(32) }),
    ).toThrow(/distinct/i);
  });

  it('throws when JWT_SECRET is shorter than 32 chars', () => {
    expect(() => loadEnv({ ...baseEnv, JWT_SECRET: 'short' })).toThrow();
  });

  it('throws when an upstream URL has a path component', () => {
    expect(() =>
      loadEnv({ ...baseEnv, AUTH_SERVICE_URL: 'http://auth:8080/v1' }),
    ).toThrow(/no path/i);
  });

  it('throws when REDIS_URL is not redis:// or rediss://', () => {
    expect(() =>
      loadEnv({ ...baseEnv, REDIS_URL: 'http://localhost:6379' }),
    ).toThrow();
  });

  it('parses GATEWAY_CORS_ORIGINS as comma-separated list', () => {
    const env = loadEnv({
      ...baseEnv,
      GATEWAY_CORS_ORIGINS: 'http://localhost:3000,https://app.example.com',
    });
    expect(env.GATEWAY_CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ]);
  });

  it('rejects a CORS origin with a trailing slash', () => {
    expect(() =>
      loadEnv({ ...baseEnv, GATEWAY_CORS_ORIGINS: 'http://localhost:3000/' }),
    ).toThrow();
  });

  it('accepts optional service URLs when omitted', () => {
    const env = loadEnv(baseEnv);
    expect(env.ORDER_SERVICE_URL).toBeUndefined();
    expect(env.DISPATCH_SERVICE_URL).toBeUndefined();
  });

  it('parses optional service URLs when provided', () => {
    const env = loadEnv({
      ...baseEnv,
      ORDER_SERVICE_URL: 'http://order:8080',
    });
    expect(env.ORDER_SERVICE_URL).toBe('http://order:8080');
  });
});
