import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket, { WebSocketServer } from 'ws';
import { bootstrap, type Bootstrap } from '@tests/helpers/bootstrap';

describe('I19 WebSocket UPGRADE proxied', () => {
  let b: Bootstrap;
  let trackingHttp: http.Server;
  let wss: WebSocketServer;
  let receivedUpgradeRequestId: string | undefined;
  let upstreamConnections = 0;

  beforeAll(async () => {
    trackingHttp = http.createServer();
    wss = new WebSocketServer({ server: trackingHttp, path: '/v1/tracking/socket.io/' });
    wss.on('connection', (ws, req) => {
      upstreamConnections += 1;
      receivedUpgradeRequestId = req.headers['x-request-id'] as string;
      ws.send('hello');
      ws.on('message', (data) => ws.send(String(data) + '-echo'));
    });
    await new Promise<void>((r) => trackingHttp.listen(0, '127.0.0.1', () => r()));
    const port = (trackingHttp.address() as AddressInfo).port;

    b = await bootstrap({
      envOverrides: { TRACKING_SERVICE_URL: `http://127.0.0.1:${port}` },
    });
  }, 60_000);

  afterAll(async () => {
    wss.close();
    await new Promise<void>((r) => trackingHttp.close(() => r()));
    await b.close();
  });

  it('proxies WS UPGRADE to tracking stub with X-Request-Id propagated; frames echo', async () => {
    const gatewayAddr = b.server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${gatewayAddr.port}/v1/tracking/socket.io/`);

    // Buffer messages from the moment the socket is created so we never miss
    // a frame that arrives between `open` and a later `once('message', ...)`.
    const queue: string[] = [];
    const waiters: ((m: string) => void)[] = [];
    ws.on('message', (data) => {
      const m = String(data);
      const next = waiters.shift();
      if (next) next(m);
      else queue.push(m);
    });
    const nextMessage = (label: string, timeoutMs = 5000): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const queued = queue.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error(`WS message timeout (${label}) at ${timeoutMs}ms`)),
          timeoutMs,
        );
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('WS open timeout at 10s — check ws-proxy implementation')),
          10_000,
        );
        ws.on('open', () => {
          clearTimeout(timer);
          resolve();
        });
        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const first = await nextMessage('hello');
      ws.send('ping');
      const second = await nextMessage('ping-echo');

      expect([first, second]).toEqual(['hello', 'ping-echo']);
      expect(receivedUpgradeRequestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    } finally {
      ws.close();
      await new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.on('close', () => resolve());
      });
    }
  }, 20_000);

  it('does not proxy an UPGRADE to a non-tracking path to the tracking upstream', async () => {
    const before = upstreamConnections;
    const gatewayAddr = b.server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${gatewayAddr.port}/v1/orders/socket.io/`);

    // The ws-proxy only routes UPGRADEs whose path starts with
    // /v1/tracking/socket.io/; everything else has its socket destroyed, so
    // the client sees an error/close and the tracking upstream is never hit.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('expected the non-tracking UPGRADE to be rejected within 5s')),
        5000,
      );
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      ws.on('error', done);
      ws.on('close', done);
      ws.on('open', () => {
        clearTimeout(timer);
        reject(new Error('non-tracking UPGRADE unexpectedly opened'));
      });
    });

    expect(upstreamConnections).toBe(before);
  }, 10_000);
});
