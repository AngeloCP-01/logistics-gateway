import type { ErrorRequestHandler } from 'express';

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly slug: string,
    public readonly title: string,
    public readonly extension?: Record<string, unknown>,
  ) {
    super(title);
  }
}

export interface ErrorMapperOptions {
  problemTypeBase: string;
}

export function errorMapper(opts: ErrorMapperOptions): ErrorRequestHandler {
  // Express error middleware requires the 4-argument signature (err, req, res, next).
  // The `_next` parameter must be present even though it is never called — omitting it
  // would cause Express to treat this as a regular middleware, not an error handler.
  return (err, req, res, _next) => {
    const requestId = req.requestId ?? '';
    if (err instanceof GatewayError) {
      res
        .status(err.status)
        .setHeader('Content-Type', 'application/problem+json')
        .json({
          type: `${opts.problemTypeBase}/${err.slug}`,
          title: err.title,
          status: err.status,
          requestId,
          ...(err.extension ?? {}),
        });
      return;
    }
    const body: Record<string, unknown> = {
      type: `${opts.problemTypeBase}/internal-error`,
      title: 'Internal Server Error',
      status: 500,
      requestId,
    };
    // In non-production, surface the cause in the RESPONSE so a 500 is debuggable
    // without tailing logs. NEVER in production (leaks internals/stack traces).
    if (process.env.NODE_ENV !== 'production' && err instanceof Error) {
      body.detail = err.message;
      body.errorName = err.name;
      body.stack = err.stack?.split('\n').slice(1, 6).map((l) => l.trim());
    }
    res.status(500).setHeader('Content-Type', 'application/problem+json').json(body);
  };
}
