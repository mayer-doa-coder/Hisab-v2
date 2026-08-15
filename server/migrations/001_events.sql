-- 001_events.sql — the event log, server side. docs/EVENTS.md §1.
--
-- AGENTS.md §6: numbered and append-only. Never edit this file once merged;
-- add 002, 003, ... instead.
--
-- Deliberate divergences from the SQLite schema in EVENTS.md §1, both
-- recorded in docs/DECISIONS.md 2026-08-15:
--
--   * No `synced_at`. It is device-local (EVENTS.md §6) and must not
--     replicate. The server records `received_at` instead, which is what
--     EVENTS.md §1 invariant 2 means by "use the server's receipt time for
--     anything that must be authoritative."
--   * `server_seq BIGSERIAL` is the pull cursor. Server-assigned, unique,
--     totally ordered — the only candidate that is all three. See DECISIONS
--     for the documented gap under concurrent inserts.
--
-- NO PROJECTION TABLES. docs/SECURITY.md §5: the server does not need
-- `balances` to serve GET /v1/events?since=, and with no server-side balance
-- to check against, "the server never rejects an event for conflicting with
-- derived state" is enforced by this schema rather than by anyone
-- remembering it.

CREATE TABLE IF NOT EXISTS events (
  id          TEXT      PRIMARY KEY,           -- device-generated UUIDv7; the idempotency key
  device_id   TEXT      NOT NULL,
  seq         BIGINT    NOT NULL,              -- monotonic per device, starts at 1
  hlc         TEXT      NOT NULL,              -- the ordering key (EVENTS.md §1 invariant 3)
  shop_id     TEXT      NOT NULL,
  type        TEXT      NOT NULL,
  payload     JSONB     NOT NULL,
  created_at  BIGINT    NOT NULL,              -- device wall clock. UNTRUSTED — display only.
  received_at BIGINT    NOT NULL,              -- server clock. Authoritative.
  server_seq  BIGSERIAL NOT NULL UNIQUE,       -- the pull cursor
  UNIQUE (device_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_hlc        ON events (hlc);
CREATE INDEX IF NOT EXISTS idx_events_shop_seq   ON events (shop_id, server_seq);

-- ---------------------------------------------------------------------------
-- Append-only, enforced by the database's own permission system rather than
-- by a trigger that has to be written correctly. EVENTS.md §1 invariant 1.
--
-- The running server connects as `hisab_app` and is granted INSERT and SELECT
-- and nothing else — no UPDATE, no DELETE, no TRUNCATE. Migrations and the
-- test harness connect as the database owner, which is how tests can truncate
-- between files without that capability existing in the application path.
--
-- CREATE ROLE is not idempotent and has no IF NOT EXISTS, hence the DO block.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hisab_app') THEN
    CREATE ROLE hisab_app NOLOGIN;
  END IF;
END
$$;

GRANT SELECT, INSERT ON events TO hisab_app;
GRANT USAGE, SELECT ON SEQUENCE events_server_seq_seq TO hisab_app;
