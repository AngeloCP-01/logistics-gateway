import type { Express, NextFunction, Request, Response } from 'express';
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'http';
import { Writable } from 'stream';
import { createProxyMiddleware, type Options } from 'http-proxy-middleware';
import { buildUpstreamHeaders, type Identity } from '../middleware/identity-headers.js';

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'express-serve-static-core' {
  interface Request {
    identity?: Identity | null;
  }
}

export interface ProxyConfigOptions {
  target: string;
  proxyTimeoutMs: number;
  retryDelayMs: number;
  /** Canonical upstream name used in the wrap envelope (e.g. 'user-service'). */
  upstreamName?: string;
}

// http-proxy's `proxyTimeout` calls `proxyReq.abort()` which surfaces as
// `ECONNRESET`, indistinguishable from upstream resets. To map timeouts to 504
// (and connection failures to 502) we install our own per-request timer via
// the `proxyReq` event and mark the request as timed-out before aborting.
const TIMED_OUT_MARKER = Symbol('upstream-timed-out');

const MAX_DETAIL_LENGTH = 256;

// Hop-by-hop headers (RFC 7230 §6.1) plus length/encoding headers that no longer
// match the post-processed body. Stripped before forwarding upstream's headers
// downstream so we can rewrite the body without lying about its size/encoding.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
]);

function truncateDetail(body: string): string {
  const oneLine = body.replace(/[\r\n]+/g, ' ');
  return oneLine.length > MAX_DETAIL_LENGTH ? oneLine.slice(0, MAX_DETAIL_LENGTH) : oneLine;
}

interface PostProcessTarget {
  statusCode: number;
  setHeader(name: string, value: number | string | readonly string[]): unknown;
  removeHeader?(name: string): void;
  writeHead(status: number, headers?: OutgoingHttpHeaders): unknown;
  write(chunk: Buffer | string): unknown;
  end(chunk?: Buffer | string): unknown;
  headersSent?: boolean;
}

export function createProxyConfig(opts: ProxyConfigOptions): Options {
  const upstreamName = opts.upstreamName ?? 'upstream';

  return {
    target: opts.target,
    changeOrigin: true,
    // `timeout` would bound the inbound socket (tearing down the client across
    // our retry); omitted on purpose. We implement the upstream timeout below.
    proxyTimeout: opts.proxyTimeoutMs,

    // We post-process upstream 5xx bodies (passthrough for application/problem+json
    // with requestId overwritten; wrap for non-7807). `selfHandleResponse: true`
    // disables the auto-pipe so the proxyRes handler owns writing the response.
    selfHandleResponse: true,

    on: {
      proxyReq: (proxyReq, req) => {
        const r = req as IncomingMessage & {
          identity?: Identity | null;
          requestId?: string;
          [TIMED_OUT_MARKER]?: boolean;
        };
        const headers = buildUpstreamHeaders(r.identity ?? null, r.requestId ?? '');
        for (const [k, v] of Object.entries(headers)) {
          proxyReq.setHeader(k, v);
        }
        r[TIMED_OUT_MARKER] = false;
        const timer = setTimeout(() => {
          r[TIMED_OUT_MARKER] = true;
          proxyReq.destroy();
        }, opts.proxyTimeoutMs);
        const clear = () => clearTimeout(timer);
        proxyReq.once('response', clear);
        proxyReq.once('error', clear);
        proxyReq.once('close', clear);
      },

      proxyRes: (proxyRes, req, res) => {
        const r = req as IncomingMessage & { requestId?: string; originalUrl?: string };
        const target = res as unknown as PostProcessTarget;

        const chunks: Buffer[] = [];
        proxyRes.on('data', (c: Buffer) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          const status = proxyRes.statusCode ?? 502;
          const contentType = String(proxyRes.headers['content-type'] ?? '');
          const isProblemJson = contentType.toLowerCase().startsWith('application/problem+json');

          // Pass non-5xx through unchanged: copy headers + body verbatim.
          if (status < 500) {
            writePassthrough(target, proxyRes.headers, status, body);
            return;
          }

          // 5xx + application/problem+json: parse, overwrite requestId, re-emit.
          if (isProblemJson) {
            let parsed: Record<string, unknown> | null = null;
            try {
              parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
            } catch {
              parsed = null;
            }
            if (parsed) {
              parsed.requestId = r.requestId ?? '';
              const newBody = Buffer.from(JSON.stringify(parsed), 'utf8');
              writeRewritten(target, proxyRes.headers, status, newBody, 'application/problem+json');
              return;
            }
            // Fall through to wrap if the body claims problem+json but won't parse.
          }

          // 5xx with non-7807 body (or unparsable 7807): wrap.
          const envelope = {
            type: '/problems/upstream-error',
            title: 'Upstream service error',
            status,
            detail: truncateDetail(body.toString('utf8')),
            instance: r.originalUrl ?? '',
            requestId: r.requestId ?? '',
            upstream: upstreamName,
          };
          const newBody = Buffer.from(JSON.stringify(envelope), 'utf8');
          writeRewritten(target, proxyRes.headers, status, newBody, 'application/problem+json');
        });
      },

      error: (err, req, res) => {
        const e = err as NodeJS.ErrnoException;
        const r = req as IncomingMessage & {
          requestId?: string;
          [TIMED_OUT_MARKER]?: boolean;
        };
        const isTimeout =
          r[TIMED_OUT_MARKER] === true ||
          e.code === 'ECONNABORTED' ||
          e.code === 'ETIMEDOUT' ||
          e.code === 'ESOCKETTIMEDOUT' ||
          /timeout/i.test(String(e.message));
        const status = isTimeout ? 504 : 502;
        const slug = isTimeout ? 'upstream-timeout' : 'upstream-unavailable';
        const title = isTimeout ? 'Upstream timeout' : 'Upstream unavailable';

        // `res` is typed as ServerResponse | Socket. Only ServerResponse has writeHead/end.
        const sr = res as ServerResponse;
        if (typeof sr.writeHead !== 'function' || sr.headersSent) {
          return;
        }
        const requestId = r.requestId ?? '';
        sr.writeHead(status, { 'Content-Type': 'application/problem+json' });
        sr.end(
          JSON.stringify({
            type: `/problems/${slug}`,
            title,
            status,
            requestId,
          }),
        );
      },
    },
  };
}

function writePassthrough(
  target: PostProcessTarget,
  upstreamHeaders: IncomingMessage['headers'],
  status: number,
  body: Buffer,
): void {
  for (const [k, v] of Object.entries(upstreamHeaders)) {
    if (v === undefined) continue;
    if (STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) continue;
    target.setHeader(k, v as string | string[] | number);
  }
  target.setHeader('Content-Length', Buffer.byteLength(body));
  target.writeHead(status);
  target.end(body);
}

function writeRewritten(
  target: PostProcessTarget,
  upstreamHeaders: IncomingMessage['headers'],
  status: number,
  body: Buffer,
  contentType: string,
): void {
  for (const [k, v] of Object.entries(upstreamHeaders)) {
    if (v === undefined) continue;
    const lk = k.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(lk)) continue;
    if (lk === 'content-type') continue;
    target.setHeader(k, v as string | string[] | number);
  }
  target.setHeader('Content-Type', contentType);
  target.setHeader('Content-Length', Buffer.byteLength(body));
  target.writeHead(status);
  target.end(body);
}

/**
 * Mounts a proxy at `mountPath` against `target` with retry-once-on-5xx for
 * idempotent methods (GET/HEAD/OPTIONS). Mutating methods (POST/PUT/PATCH/DELETE)
 * are forwarded once with no retry.
 *
 * Implementation note: http-proxy-middleware has no native retry support, so
 * for idempotent methods we wrap the underlying response with a buffering
 * Writable that captures upstream status + headers + body without touching the
 * real socket. If the captured status is >= 500, we sleep `retryDelayMs` then
 * re-issue the proxy call against the real response. Otherwise we flush the
 * buffered response.
 *
 * The buffered response is also used as the error sink: when http-proxy
 * encounters a connection failure or timeout, its `error` callback writes a
 * 5xx Problem+JSON body. We treat that as a real upstream failure (no retry
 * for connection refused, retry once for upstream 5xx) — the captured status
 * decides which branch runs.
 */
export function mountProxyWithRetry(args: {
  app: Express;
  mountPath: string;
  target: string;
  proxyTimeoutMs: number;
  retryDelayMs: number;
  /** Canonical name used in the upstream-error wrap envelope. */
  upstreamName?: string;
}): void {
  const proxy = createProxyMiddleware(
    createProxyConfig({
      target: args.target,
      proxyTimeoutMs: args.proxyTimeoutMs,
      retryDelayMs: args.retryDelayMs,
      ...(args.upstreamName !== undefined ? { upstreamName: args.upstreamName } : {}),
    }),
  );

  args.app.use(args.mountPath, async (req: Request, res: Response, next: NextFunction) => {
    // Restore the full original URL. Express's `app.use(mountPath, ...)` strips
    // the mount prefix from `req.url` before this handler runs, but spec §1
    // decision #6 locks pass-through forwarding (upstream sees `/v1/<svc>/...`
    // unchanged). Reset before the proxy reads `req.url`.
    req.url = req.originalUrl;

    if (!IDEMPOTENT_METHODS.has(req.method ?? '')) {
      await proxy(req, res, next);
      return;
    }

    const buffered = new BufferedResponse(res);
    const status = await new Promise<number>((resolve) => {
      buffered.onDone((s) => resolve(s));
      void proxy(req, buffered as unknown as Response, next);
    });

    // Retry once on upstream 5xx. Connection-refused / timeout already produced
    // a 502/504 problem+json via the proxy's error handler — treat those as
    // retryable too (the spec says: 5xx OR connection error). After the retry,
    // forward whatever the second call returns.
    if (status < 500) {
      buffered.flush();
      return;
    }

    await new Promise((r) => setTimeout(r, args.retryDelayMs));
    buffered.discard();
    await proxy(req, res, next);
  });
}

/**
 * Buffers writeHead/setHeader/statusCode/write/end calls so the wrapper can
 * inspect the upstream status before deciding to flush or retry. Extends
 * `stream.Writable` so that http-proxy's `proxyRes.pipe(res)` works natively:
 * pipe ends up invoking `_write` for every chunk and `end()` once.
 *
 * Implements the subset of `ServerResponse` that http-proxy v1's
 * web-outgoing passes call: `statusCode`/`statusMessage` setters, `setHeader`,
 * `getHeader`, `headersSent`, and `finished`.
 */
class BufferedResponse extends Writable {
  statusCode = 200;
  statusMessage?: string;
  private capturedHeaders: OutgoingHttpHeaders = {};
  private chunks: Buffer[] = [];
  private done = false;
  private onDoneCb?: (status: number) => void;

  constructor(private readonly inner: ServerResponse) {
    super();
  }

  onDone(cb: (status: number) => void): void {
    this.onDoneCb = cb;
  }

  // ----- ServerResponse-compatible API surface used by http-proxy -----

  writeHead(
    status: number,
    headersOrReason?: string | OutgoingHttpHeaders,
    maybeHeaders?: OutgoingHttpHeaders,
  ): this {
    this.statusCode = status;
    const headers = typeof headersOrReason === 'string' ? maybeHeaders : headersOrReason;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined) this.capturedHeaders[k.toLowerCase()] = v;
      }
    }
    return this;
  }

  setHeader(name: string, value: number | string | readonly string[]): this {
    this.capturedHeaders[name.toLowerCase()] = value as string | string[] | number;
    return this;
  }

  getHeader(name: string): number | string | string[] | undefined {
    return this.capturedHeaders[name.toLowerCase()] as number | string | string[] | undefined;
  }

  removeHeader(name: string): void {
    delete this.capturedHeaders[name.toLowerCase()];
  }

  flushHeaders(): void {
    /* no-op: buffered until flush() */
  }

  get headersSent(): boolean {
    return false;
  }

  get finished(): boolean {
    return this.done;
  }

  // ----- Writable plumbing for proxyRes.pipe(res) -----

  override _write(chunk: Buffer | string, _enc: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    cb();
  }

  override end(...args: unknown[]): this {
    // Mirror http.ServerResponse#end(chunk?, encoding?, cb?) — accept an
    // optional final chunk and ignore encoding/callback.
    const first = args[0];
    if (typeof first === 'string' || Buffer.isBuffer(first)) {
      this.chunks.push(Buffer.isBuffer(first) ? first : Buffer.from(first));
    }
    if (this.done) return this;
    this.done = true;
    if (this.onDoneCb) this.onDoneCb(this.statusCode);
    return this;
  }

  // ----- Flush / discard -----

  flush(): void {
    if (this.inner.headersSent) return;
    for (const [k, v] of Object.entries(this.capturedHeaders)) {
      if (v !== undefined) this.inner.setHeader(k, v as number | string | readonly string[]);
    }
    this.inner.statusCode = this.statusCode;
    if (this.statusMessage) this.inner.statusMessage = this.statusMessage;
    for (const c of this.chunks) this.inner.write(c);
    this.inner.end();
  }

  discard(): void {
    this.chunks = [];
    this.capturedHeaders = {};
    this.statusCode = 200;
    this.done = false;
  }
}
