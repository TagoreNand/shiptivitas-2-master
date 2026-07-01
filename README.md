# shiptivity-api v2

Enterprise-grade Kanban board microservice — TypeScript, PostgreSQL, Redis
transactional outbox. A hardened evolution of the original Shiptivity prototype.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design, diagrams, and
the 4-pillar enhancement plan.

## Highlights

- **Layered, strictly-typed architecture** — routing → controllers → services →
  repositories, with a pure, unit-tested domain core.
- **LexoRank ordering** — cards are ordered by a fractional-index `rank` key, so
  a move is a single-row, O(1) update that locks only its two neighbours (not the
  lane). Order can never gap or duplicate, even under simultaneous moves.
- **Concurrency-safe** — optimistic concurrency (`version`) + `SERIALIZABLE`
  transactions with `FOR UPDATE` neighbour locks + retry on serialization failure.
- **JWT auth** — `jose`-based Bearer verification (HS256 or OIDC/JWKS) with
  scope authorization; agents authenticate as first-class principals.
- **Immutable audit log** — every state change recorded co-transactionally.
- **Event-driven** — transactional outbox relayed to Redis Pub/Sub; Python LLM
  agents consume events and call back as ordinary OCC-respecting clients.
- **Distributed tracing** — OpenTelemetry spans across HTTP → move → outbox, with
  W3C trace context threaded into events so an agent's actions continue the same
  trace (all-in-one Jaeger in compose).
- **Live board (SSE)** — the event stream is pushed to browsers via Server-Sent
  Events at `/api/v1/stream`; a card another user or agent moves appears instantly.
- **Production-ready** — Docker, CI, Pino JSON logs, Prometheus metrics,
  health/readiness probes, helmet/CORS/rate-limiting.

## Quickstart

```bash
docker compose up --build          # postgres + redis + api, migrations included

# or locally:
cp .env.example .env
npm install
npm run migrate
npm run dev
npm test                           # rank stress + service OCC tests, no infra
npm run test:integration           # real Postgres + concurrency proof (Docker)
npm run mint-token agent:bot "board:write"   # dev JWT for testing/agents
```

Position a card with neighbour references (preferred) or the legacy slot:

```jsonc
PUT /api/v1/clients/7
{ "afterId": 3, "version": 2 }          // place card 7 right after card 3
{ "status": "complete", "version": 2 }  // move to complete (appended)
```

## Key endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/v1/clients` | Full board |
| GET | `/api/v1/clients/:id` | One card |
| PUT | `/api/v1/clients/:id` | Move/reorder a card (OCC-guarded) |
| GET | `/api/v1/stream` | Live board updates (SSE) |
| GET | `/healthz` `/readyz` `/metrics` | Ops |

The original prototype's JavaScript is preserved under `legacy/` for reference.
