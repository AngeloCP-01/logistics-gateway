import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { mountProxyWithRetry } from '@/proxy/proxy-config';
import { errorMapper } from '@/middleware/error-mapper';

function makeStub(callbacks: Array<(res: http.ServerResponse) => void>) {
  let i = 0;
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    const server = http.createServer((_, res) => {
      const cb = callbacks[i] ?? callbacks[callbacks.length - 1];
      i += 1;
      cb(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}

async function makeApp(targetUrl: string, proxyTimeoutMs = 1000) {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'req-id';
    next();
  });
  mountProxyWithRetry({
    app,
    mountPath: '/up',
    target: targetUrl,
    proxyTimeoutMs,
    retryDelayMs: 50,
  });
  app.use(errorMapper({ problemTypeBase: '/problems' }));
  return app;
}

describe('proxy-config retry', () => {
  it('retries GET once on 5xx', async () => {
    const stub = await makeStub([
      (res) => {
        res.writeHead(502);
        res.end('bad');
      },
      (res) => {
        res.writeHead(200);
        res.end('ok');
      },
    ]);
    try {
      const app = await makeApp(`http://127.0.0.1:${stub.port}`);
      const res = await request(app).get('/up/anything');
      expect(res.status).toBe(200);
      expect(res.text).toBe('ok');
    } finally {
      stub.server.close();
    }
  });

  it('does NOT retry POST on 5xx', async () => {
    let calls = 0;
    const stub = await makeStub([
      (res) => {
        calls += 1;
        res.writeHead(502);
        res.end('bad');
      },
    ]);
    try {
      const app = await makeApp(`http://127.0.0.1:${stub.port}`);
      const res = await request(app).post('/up/anything').send({});
      expect(res.status).toBe(502);
      expect(calls).toBe(1);
    } finally {
      stub.server.close();
    }
  });

  it('returns 502 upstream-unavailable when target is unreachable', async () => {
    const app = await makeApp('http://127.0.0.1:1');
    const res = await request(app).get('/up/anything');
    expect(res.status).toBe(502);
    expect(res.body.type).toMatch(/upstream-unavailable$/);
  });

  it('returns 504 upstream-timeout when stub never responds', async () => {
    const stub = await makeStub([
      () => {
        /* never write */
      },
    ]);
    try {
      // 2000ms timeout (raised from plan's 1000ms) keeps the test deterministic
      // when CI runners are slow to schedule the proxy's timeout callback.
      const app = await makeApp(`http://127.0.0.1:${stub.port}`, 2000);
      const res = await request(app).get('/up/anything');
      expect(res.status).toBe(504);
      expect(res.body.type).toMatch(/upstream-timeout$/);
    } finally {
      stub.server.close();
    }
  });
});
