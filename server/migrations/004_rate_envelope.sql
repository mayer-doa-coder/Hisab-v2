-- 004_rate_envelope.sql — SECURITY.md §5: "Per-user, per-event-type mutation
-- rate envelopes. A legitimate shop does not create 5,000 credit events in a
-- day; anomalous volume is a reliable signal."
--
-- The envelope check counts events by (shop_id, type) within a rolling
-- window from the events table itself — no new table, since the events
-- table already carries everything needed. This index is what makes that
-- count cheap instead of a sequential scan as the table grows.

CREATE INDEX IF NOT EXISTS idx_events_shop_type_received
  ON events (shop_id, type, received_at);
