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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err, req, res, _next) => {
    const requestId = (req as any).requestId ?? '';
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
    res
      .status(500)
      .setHeader('Content-Type', 'application/problem+json')
      .json({
        type: `${opts.problemTypeBase}/internal-error`,
        title: 'Internal Server Error',
        status: 500,
        requestId,
      });
  };
}
