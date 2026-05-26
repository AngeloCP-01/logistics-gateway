import { z } from 'zod';

const urlNoPathSchema = z
  .string()
  .url()
  .refine((u) => {
    const url = new URL(u);
    return (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash;
  }, 'must have no path, query, or fragment');

const httpUrlSchema = urlNoPathSchema.refine(
  (u) => /^https?:\/\//.test(u),
  'must use http:// or https://',
);

const redisUrlSchema = z
  .string()
  .url()
  .refine((u) => /^rediss?:\/\//.test(u), 'must use redis:// or rediss://');

const originSchema = z
  .string()
  .refine((s) => /^https?:\/\/[^/]+$/.test(s), 'origin must be scheme://host[:port], no path, no trailing slash');

const corsOriginsSchema = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(originSchema).min(1));

const numFromString = (defaultValue: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((s) => (s === undefined ? defaultValue : Number(s)))
    .pipe(z.number().int().min(min));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    GATEWAY_PORT: z.string().transform(Number).pipe(z.number().int().min(1).max(65535)),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_SERVICE_NAME: z.string().default('logistics-gateway'),

    JWT_SECRET: z.string().min(32),
    SERVICE_JWT_SECRET: z.string().min(32),

    REDIS_URL: redisUrlSchema,

    AUTH_SERVICE_URL: httpUrlSchema,
    USER_SERVICE_URL: httpUrlSchema,
    ORDER_SERVICE_URL: httpUrlSchema.optional(),
    DISPATCH_SERVICE_URL: httpUrlSchema.optional(),
    TRACKING_SERVICE_URL: httpUrlSchema.optional(),
    NOTIFICATION_SERVICE_URL: httpUrlSchema.optional(),
    AI_SERVICE_URL: httpUrlSchema.optional(),

    GATEWAY_CORS_ORIGINS: corsOriginsSchema,

    GATEWAY_PROXY_TIMEOUT_MS: numFromString(10000, 1000),
    GATEWAY_RETRY_DELAY_MS: numFromString(250, 0),
    GATEWAY_ANON_RPM: numFromString(60, 1),
    GATEWAY_AUTH_RPM: numFromString(300, 1),
    GATEWAY_RATE_LIMIT_WINDOW_MS: numFromString(60000, 1000),
    GATEWAY_SHUTDOWN_GRACE_MS: numFromString(10000, 0),
  })
  .refine(
    (env) => env.JWT_SECRET !== env.SERVICE_JWT_SECRET,
    { message: 'JWT_SECRET and SERVICE_JWT_SECRET must be distinct values' },
  );

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}
