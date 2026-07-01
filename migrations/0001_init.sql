-- 0001_init.sql — schema for the Kanban board, audit ledger, and outbox.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- clients (cards).
--   * `rank`    : LexoRank/fractional-index ordering key within a lane.
--                 COLLATE "C" gives binary ordering that matches the rank-key
--                 generator exactly — a locale collation would corrupt order.
--   * `version` : optimistic-concurrency token, bumped on every write.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL CHECK (status IN ('backlog', 'in-progress', 'complete')),
  rank        TEXT COLLATE "C" NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one card per (lane, rank). With fractional keys this is effectively
-- never contended, but the constraint makes a corrupt ordering uncommittable.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_status_rank_uniq;
ALTER TABLE clients
  ADD CONSTRAINT clients_status_rank_uniq UNIQUE (status, rank)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS clients_status_rank_idx ON clients (status, rank);

-- ---------------------------------------------------------------------------
-- audit_log — append-only ledger. One row per state change, same transaction.
-- In production: REVOKE UPDATE, DELETE on this table from the app role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL,
  actor          TEXT NOT NULL,
  action         TEXT NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  from_rank      TEXT,
  to_rank        TEXT,
  version_before INTEGER,
  version_after  INTEGER,
  request_id     TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_client_idx ON audit_log (client_id, created_at);

-- ---------------------------------------------------------------------------
-- outbox — transactional outbox, drained to Redis by the relay.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  attempts     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_unpublished_idx
  ON outbox (created_at) WHERE published_at IS NULL;
