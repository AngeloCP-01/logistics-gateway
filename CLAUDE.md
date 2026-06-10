# logistics-gateway — Repo Guide

> Central HTTP entry point. JWT validation, routing, rate limiting, WebSocket proxy, request-id propagation.

**Phase:** 2 (Gateway + User)
**Status:** ✅ **v0.1.0 shipped** (2026-05-28) — CI green, image `ghcr.io/angelocp-01/gateway:latest` + `:<sha>` published. 42 unit + 31 integration tests (real Redis via testcontainers). The tracking WebSocket proxy route was **wired + smoke-tested in Phase 5** (`TRACKING_SERVICE_URL` env + a `/v1/tracking/socket.io/` path-gating upgrade test).

## What this service does

Single public HTTPS endpoint for the platform (`https://api.<domain>/v1/...`). Validates the user JWT, attaches advisory identity headers (`X-User-Id`, `X-User-Role`, `X-Request-Id`), routes to upstream services (pass-through — no prefix stripping), enforces a two-tier sliding-window rate limit (per-IP anon / per-user authed) in Redis, retries idempotent methods once on a 5xx/connection error, and proxies the tracking WebSocket upgrade. It can self-mint short-lived service JWTs (`SERVICE_JWT_SECRET`, distinct from the user `JWT_SECRET`).

No business logic. No database. Pure gateway.

## Locked decisions

- **Tech**: Node 20 LTS, TypeScript, Express + `http-proxy-middleware`.
- **JWT validation**: HS256 (V1). Verifies signature + expiry only. Does not introspect roles beyond claim extraction.
- **Identity propagation**: attaches `X-User-Id`, `X-User-Role`, `X-Request-Id` to every upstream request.
- **Request ID**: generated here (UUID v7) on every inbound request; propagated to every downstream call.
- **Rate limiting**: two-tier sliding window in Redis — per-IP (anonymous) and per-user (authenticated); service callers exempt.
- **Retry**: `GET`/`HEAD`/`OPTIONS` retried once after ~250ms on a 5xx/connection error; mutating methods never retried; 10s proxy timeout.
- **WebSocket**: proxies `wss://api.<domain>/v1/tracking/socket.io/` to tracking-service via `http-proxy` directly (http-proxy-middleware v3 changed the WS upgrade API). The gateway does **not** validate the handshake JWT — tracking owns handshake auth. Wired to `TRACKING_SERVICE_URL`.
- **Public endpoints**: `/healthz`, `/readyz`, `/v1/auth/*`, `/v1/users/*`, `/v1/orders/*`, `/v1/dispatch/*`, `/v1/tracking/*`, `/v1/notifications/*`, `/v1/ai/*` (Phase 9), plus the WebSocket path.

## Route table

All routes are declared; the **Live** column reflects whether the upstream service is shipped (an env URL pointing at a non-running service simply 502s via the retry path).

| Path prefix                        | Upstream               | Auth required                                 | Live                |
| ---------------------------------- | ---------------------- | --------------------------------------------- | ------------------- |
| `/v1/auth/*`                       | `auth-service`         | No (for register/login); Yes (for refresh/me) | ✅ Phase 1          |
| `/v1/users/*`                      | `user-service`         | Yes                                           | ✅ Phase 2          |
| `/v1/orders/*`                     | `order-service`        | Yes                                           | ✅ Phase 3          |
| `/v1/dispatch/*`                   | `dispatch-service`     | Yes (admin or driver)                         | ✅ Phase 4          |
| `/v1/tracking/*`                   | `tracking-service`     | Yes                                           | ✅ Phase 5          |
| `wss://.../v1/tracking/socket.io/` | `tracking-service` WS  | Yes (JWT in handshake)                        | ✅ Phase 5          |
| `/v1/notifications/*`              | `notification-service` | Yes                                           | ⬜ Phase 6          |
| `/v1/ai/*`                         | `ai-service`           | Yes                                           | 💤 Phase 9 (stretch) |

## Conventions

- Same as platform: pino logging (with auth-header redaction), Zod env validation, `/healthz` + `/readyz` (env + Redis only — shallow, no upstream pings), RFC 7807 errors. ESM build (relative `.js` imports — `tsc` doesn't rewrite `@/` aliases at runtime; the Phase-2 ship lesson).
- Upstream URLs come from env vars: `AUTH_SERVICE_URL`, `USER_SERVICE_URL`, `ORDER_SERVICE_URL`, `DISPATCH_SERVICE_URL`, `TRACKING_SERVICE_URL`, `NOTIFICATION_SERVICE_URL`, `AI_SERVICE_URL`.
- Secrets: `JWT_SECRET` (= auth's `AUTH_JWT_SECRET`, verifies user tokens) and `SERVICE_JWT_SECRET` (signs service tokens) must be **distinct** — boot fails fast if they match.
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

- Spec: [`../docs/superpowers/specs/2026-05-26-gateway-design.md`](../docs/superpowers/specs/2026-05-26-gateway-design.md) (the 8 locked decisions) + decomposition [`§4.1, §4.4`](../docs/superpowers/specs/2026-05-18-platform-decomposition-design.md)
- Plan: [`../docs/superpowers/plans/2026-05-26-phase-2-gateway.md`](../docs/superpowers/plans/2026-05-26-phase-2-gateway.md) (shipped)
- Retro: [`../docs/superpowers/retros/2-gateway.md`](../docs/superpowers/retros/2-gateway.md)
- Tracker: [`../docs/superpowers/tracker.md`](../docs/superpowers/tracker.md)
