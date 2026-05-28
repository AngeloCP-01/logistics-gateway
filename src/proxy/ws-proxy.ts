import type http from 'node:http';
import type net from 'node:net';
import { createProxyMiddleware, type RequestHandler } from 'http-proxy-middleware';
import type { Env } from '@/config/env';

const WS_PATH = '/v1/tracking/socket.io/';

/**
 * Attaches the WebSocket UPGRADE proxy to the given HTTP server.
 * Gateway does NOT validate the JWT on UPGRADE — tracking-service owns handshake auth (Phase 5).
 */
export function attachWebSocketProxy(server: http.Server, env: Env): void {
  if (!env.TRACKING_SERVICE_URL) return;
  const wsProxy: RequestHandler = createProxyMiddleware({
    target: env.TRACKING_SERVICE_URL,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReqWs: (proxyReq, req) => {
        const rid = (req as http.IncomingMessage & { requestId?: string }).requestId ?? '';
        if (rid) proxyReq.setHeader('X-Request-Id', rid);
      },
    },
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith(WS_PATH)) {
      socket.destroy();
      return;
    }
    wsProxy.upgrade(req, socket as net.Socket, head);
  });
}
