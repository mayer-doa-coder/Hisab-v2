-- 003_auth_hardening.sql — SECURITY.md §4, the items Step 10 deliberately
-- left undone and named: device-fingerprint-bound refresh tokens, rotation
-- on every use, family revocation with a security event, and rate-limited
-- PIN attempts with exponential lockout.
--
-- AGENTS.md §6: numbered and append-only. Never edit once merged.

-- ---------------------------------------------------------------------------
-- Token rotation and fingerprint binding.
--
-- Step 10's 002_auth.sql said: "There is no device_fingerprint column here
-- on purpose... Step 11 can add it in 003." This is that.
--
--   family_id           — every refresh token minted from the same login (and
--                          every token it rotates into) shares one family_id.
--                          Revoking a family revokes every token in it.
--   device_fingerprint   — bound at issue time. A refresh carrying the wrong
--                          fingerprint is treated as theft, not a retry.
--   rotated_at           — NULL while this is the live token in its family.
--                          Set the instant it is redeemed. A second redemption
--                          of an already-rotated token is also treated as
--                          theft (a legitimate client only ever presents the
--                          newest token in a family).
-- ---------------------------------------------------------------------------
ALTER TABLE tokens ADD COLUMN family_id           TEXT;
ALTER TABLE tokens ADD COLUMN device_fingerprint  TEXT;
ALTER TABLE tokens ADD COLUMN rotated_at          BIGINT;

CREATE INDEX IF NOT EXISTS idx_tokens_family ON tokens (family_id);

-- ---------------------------------------------------------------------------
-- Security events. EVENTS.md §6: "USER_LOGGED_IN — Auth is not ledger data.
-- Security events go to a separate local log." This is that separate log,
-- server-side, for events the SERVER detects (family revocation on token
-- reuse or fingerprint mismatch). It is not an event-sourcing table — no
-- append-only requirement, no fold, no sync to the client.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
  id         TEXT   PRIMARY KEY,
  shop_id    TEXT   NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  kind       TEXT   NOT NULL CHECK (kind IN ('REFRESH_REUSE', 'FINGERPRINT_MISMATCH')),
  -- Structured, never free text containing PII (SECURITY.md §6). Holds only
  -- non-identifying facts: family id, token age, counts.
  detail     TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_shop ON security_events (shop_id, created_at);

-- ---------------------------------------------------------------------------
-- Login attempts. Keyed by phone, not shop_id, and populated for BOTH real
-- and nonexistent phones — the audit's login() already makes "unknown phone"
-- and "wrong PIN" indistinguishable in the response; if lockout were only
-- tracked for real accounts, locked-vs-invalid-credentials would reopen that
-- same oracle. Tracking every phone that gets probed, real or not, keeps a
-- locked-out response equally possible for both.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  phone        TEXT   PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT,
  updated_at   BIGINT NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON security_events TO hisab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_attempts  TO hisab_app;
