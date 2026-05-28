# logistics-gateway

Central HTTP entry point for the AI Logistics Platform. JWT validation, routing, rate limiting, WebSocket proxy, request-id propagation.

> **Status:** scaffolded — implementation pending Phase 2 (see `CLAUDE.md`).

## Architecture overview

```
                                    ┌──────────────────────┐
   Public Internet ──HTTPS──►       │   logistics-gateway  │       Render private network
                                    │   (this service)     │
                                    └─────────┬────────────┘
                                              │
                          ┌───────────────────┼───────────────────┬──────────────────┐
                          ▼                   ▼                   ▼                  ▼
                    auth-service         user-service        order-service     tracking-service ...
                    (Render private)     (Render private)    (Render private)  (Render private)
                                              │
                              ┌───────────────┴───────────────┐
                              ▼                                ▼
                            Redis (rate-limit counters)     [upstreams have their own DBs]
```

- **Process shape**: stateless Node 20 + Express + `http-proxy-middleware`. Horizontally scalable. No database. Only persistent dependency: Redis (shared with the rest of the platform for rate-limit counters).
- **Public surface**: HTTPS on port `${GATEWAY_PORT}` exposed by Render. The gateway is the only Render service set to "public"; every other service runs on the Render private network and is reachable only by service name.
- **WebSocket**: the same process handles the HTTP UPGRADE path for `/v1/tracking/socket.io/` and proxies the WS connection to the tracking-service.
- **No business logic, no database, no domain layer.** The platform conventions' "Node service" folder shape (`domain/`, `application/`, `infrastructure/`, `interfaces/`) does not naturally fit a pure gateway. This repo uses a leaner local shape and records that deviation here per platform CLAUDE.md.
- **Stateless**: no per-process memory of users or sessions. Every rate-limit decision goes to Redis. Restarts are zero-impact.
- **Trust boundary**: defense-in-depth. The gateway does *best-effort* JWT validation — it sets the request identity if a valid token is present, otherwise the request continues as anonymous and the downstream service is responsible for authorizing. The gateway never blocks for "auth required"; downstream services do.

See [`docs/superpowers/specs/2026-05-26-gateway-design.md`](../docs/superpowers/specs/2026-05-26-gateway-design.md) for the full design, including the trust model, service-JWT shape, rate-limit policy, and integration-test strategy.

## Local development

```bash
# 1. Bring up Redis (compose defines only Redis; auth and user are run separately)
docker compose -f docker-compose.dev.yml up -d

# 2. Configure env
cp .env.example .env
# Edit .env: set JWT_SECRET to match auth-service's AUTH_JWT_SECRET; set SERVICE_JWT_SECRET (different value).

# 3. Run dev server
npm install
npm run dev
```

Gateway listens on `${GATEWAY_PORT}` (default 8080). Hit `http://localhost:8080/healthz` to verify.

## Running tests

```bash
npm test            # unit tests (fast, no containers)
npm run test:int    # integration tests (testcontainers — needs Docker)
```

Integration tests spin up real Redis via testcontainers. Each integration test runs serially (Jest `maxWorkers: 1`).

## Deploy

Auto-deploys to Render on every push to `main`. See `logistics-infrastructure/deploy/render.yaml` for the service block.
