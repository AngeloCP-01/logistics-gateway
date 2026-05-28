import type http from 'node:http';
import type net from 'node:net';
import httpProxy from 'http-proxy';
import { v7 as uuidv7 } from 'uuid';
import type { Env } from '../config/env.js';

const WS_PATH = '/v1/tracking/socket.io/';
const INBOUND_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Attaches the WebSocket UPGRADE proxy to the given HTTP server.
 *
 * Implementation note: we use `http-proxy` directly rather than the
 * higher-level `http-proxy-middleware` wrapper. UPGRADE events never traverse
 * Express middleware, so the wrapper's Express-orientation gives no benefit
 * here; talking to http-proxy directly lets the X-Request-Id handling live
 * entirely in the `proxyReqWs` event without reaching into the Express
 * request shape. http-proxy is a stable transitive dependency.
 *
 * Gateway does NOT validate the JWT on UPGRADE — the tracking-service owns
 * handshake auth (Phase 5).
 */
export function attachWebSocketProxy(server: http.Server, env: Env): void {
  if (!env.TRACKING_SERVICE_URL) return;

  const proxy = httpProxy.createProxyServer({
    target: env.TRACKING_SERVICE_URL,
    changeOrigin: true,
    ws: true,
  });

  // Propagate / generate X-Request-Id on the proxied UPGRADE request. The
  // Express request-id middleware never runs for UPGRADE events, so we
  // mirror its behavior here: honor a valid inbound X-Request-Id, otherwise
  // mint a fresh UUID v7.
  proxy.on('proxyReqWs', (proxyReq, req) => {
    const inbound = req.headers['x-request-id'];
    const single = Array.isArray(inbound) ? inbound[0] : inbound;
    const id = single && INBOUND_PATTERN.test(single) ? single : uuidv7();
    proxyReq.setHeader('X-Request-Id', id);
  });

  // Errors on the WS upstream must not crash the process; destroy the client
  // socket so the browser sees a clean disconnect.
  proxy.on('error', (_err, _req, target) => {
    const socket = target as net.Socket | undefined;
    if (socket && !socket.destroyed) socket.destroy();
  });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith(WS_PATH)) {
      socket.destroy();
      return;
    }
    proxy.ws(req, socket as net.Socket, head);
  });
}
