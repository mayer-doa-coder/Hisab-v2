-- 002_auth.sql — shops and opaque bearer tokens. docs/SECURITY.md §4.
--
-- AGENTS.md §6: numbered and append-only. Never edit once merged.
--
-- SCOPE: login / refresh / logout, functional but NOT hardened. Deliberately
-- absent, and deliberately NOT stubbed (SECURITY.md §4: "an endpoint that
-- doesn't verify is an auth bypass. Either it works or it isn't merged"):
--
--   * device-fingerprint binding and token-family revocation  — Step 11
--   * refresh-token rotation on use                           — Step 11
--   * server-side exponential lockout on failed PIN attempts  — Step 11
--
-- There is no `device_fingerprint` column here on purpose. Adding an unused
-- column now would be data collection ahead of a feature (SECURITY.md §6),
-- and Step 11 can add it in 003.

CREATE TABLE IF NOT EXISTS shops (
  id         TEXT   PRIMARY KEY,
  -- SECURITY.md §4: phone number, not email, as the primary identifier.
  -- Stored as typed; no normalisation is claimed here.
  phone      TEXT   NOT NULL UNIQUE,
  -- scrypt, formatted `scrypt$N$r$p$<salt-hex>$<hash-hex>`. Never the PIN
  -- itself, never reversible. See server/src/auth/passwords.ts.
  pin_hash   TEXT   NOT NULL,
  created_at BIGINT NOT NULL
);

-- Opaque random tokens. Only the SHA-256 of the token is stored, so a
-- read of this table does not yield anything usable as a credential.
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT   PRIMARY KEY,
  shop_id    TEXT   NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
  kind       TEXT   NOT NULL CHECK (kind IN ('ACCESS', 'REFRESH')),
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_shop ON tokens (shop_id);

-- Unlike `events`, these are not ledger data (EVENTS.md §6: "Auth is not
-- ledger data") and are genuinely mutable — logout deletes, expiry sweeps
-- delete. The append-only restriction is specific to the event log.
GRANT SELECT, INSERT, UPDATE, DELETE ON shops  TO hisab_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tokens TO hisab_app;
