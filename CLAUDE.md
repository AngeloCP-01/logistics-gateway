# logistics-gateway — Repo Guide

> Central HTTP entry point. JWT validation, routing, rate limiting, WebSocket proxy, request-id propagation.

**Phase:** 2 (Gateway + User)
**Status:** ⬜ Not started — scaffold only. Brainstorm a Gateway spec before implementation.

## What this service does

Single public HTTPS endpoint for the platform (`https://api.<domain>/v1/...`). Validates JWTs, attaches identity headers (`X-User-Id`, `X-User-Role`, `X-Request-Id`), routes to upstream services, enforces rate limits per IP and per user. Also proxies WebSocket connections to `logistics-tracking-service`.

No business logic. No database. Pure gateway.

## Locked decisions

- **Tech**: Node 20 LTS, TypeScript, Express + `http-proxy-middleware`.
- **JWT validation**: HS256 (V1). Verifies signature + expiry only. Does not introspect roles beyond claim extraction.
- **Identity propagation**: attaches `X-User-Id`, `X-User-Role`, `X-Request-Id` to every upstream request.
- **Request ID**: generated here (UUID v7) on every inbound request; propagated to every downstream call.
- **Rate limiting**: per-IP (anonymous) and per-user (authenticated) sliding window in Redis.
- **WebSocket**: proxies `wss://api.<domain>/v1/tracking/socket.io/` to tracking-service.
- **Public endpoints**: `/healthz`, `/readyz`, `/v1/auth/*`, `/v1/users/*`, `/v1/orders/*`, `/v1/dispatch/*`, `/v1/tracking/*`, `/v1/notifications/*`, `/v1/ai/*` (Phase 9), plus the WebSocket path.

## Route table (V1 target)

| Path prefix                        | Upstream               | Auth required                                 |
| ---------------------------------- | ---------------------- | --------------------------------------------- |
| `/v1/auth/*`                       | `auth-service`         | No (for register/login); Yes (for refresh/me) |
| `/v1/users/*`                      | `user-service`         | Yes                                           |
| `/v1/orders/*`                     | `order-service`        | Yes                                           |
| `/v1/dispatch/*`                   | `dispatch-service`     | Yes (admin or driver)                         |
| `/v1/tracking/*`                   | `tracking-service`     | Yes                                           |
| `/v1/notifications/*`              | `notification-service` | Yes                                           |
| `/v1/ai/*`                         | `ai-service`           | Yes (Phase 9)                                 |
| `wss://.../v1/tracking/socket.io/` | `tracking-service` WS  | Yes (JWT in handshake)                        |

## Conventions

- Same as platform: pino logging, Zod env validation, `/healthz` + `/readyz`, RFC 7807 errors.
- Upstream URLs come from env vars: `AUTH_SERVICE_URL`, `USER_SERVICE_URL`, etc.
- The gateway is the only public service. Other services live on the Render private network.

## Spec

The full design contract is [`docs/superpowers/specs/2026-05-26-gateway-design.md`](../docs/superpowers/specs/2026-05-26-gateway-design.md). All decisions previously listed as "Open items" are now locked there.

## Repo deviation from platform §2.1

This service has no `domain/` or `application/` layers (no business logic, no DB). Folder shape is lean: `src/{config, middleware, proxy, health, infrastructure}` + `app.ts` + `server.ts`. See spec §3.1.

## Don't do

- Don't add business logic here. Forward, don't transform payloads.
- Don't read the JWT's role claim and conditionally route — let downstream services authorize. Gateway only validates signature + expiry.
- Don't add service-discovery magic. Env-var URLs only.
- Don't fan out to multiple upstreams from a single inbound request. One inbound = one upstream.

## Pointers

- Spec: [`../docs/superpowers/specs/2026-05-18-platform-decomposition-design.md`](../docs/superpowers/specs/2026-05-18-platform-decomposition-design.md) §4.1, §4.4
- Plan: TBD (brainstorm + plan written in Phase 2)
- Tracker: [`../docs/superpowers/tracker.md`](../docs/superpowers/tracker.md)
