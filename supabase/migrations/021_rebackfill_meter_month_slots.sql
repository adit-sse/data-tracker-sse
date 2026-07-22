-- Re-run 018's backfill to capture drift.
--
-- 018 backfilled slots at the moment it ran, but the old code stayed deployed
-- and kept writing PENDING rows into actual_invoices afterwards. Those rows
-- never reached meter_month_slots, so 019's DELETE would discard their state.
--
-- Run this AFTER deploying the code that writes slots (at which point no new
-- PENDING rows can appear in actual_invoices) and BEFORE the cleanup migration.
--
-- Identical to 018's backfill and idempotent: ON CONFLICT DO NOTHING means
-- existing slots are never modified — in particular an existing DEACTIVATED or
-- ERROR slot is not downgraded to PENDING.

INSERT INTO meter_month_slots (meter_id, month_start, status, created_at)
SELECT
  ai.meter_id,
  date_trunc('month', ai.period_start_date::date)::date AS month_start,
  CASE
    WHEN bool_or(ai.status = 'ERROR')       THEN 'ERROR'
    WHEN bool_or(ai.status = 'DEACTIVATED')
     AND NOT bool_or(ai.status = 'PENDING') THEN 'DEACTIVATED'
    ELSE 'PENDING'
  END AS status,
  now() AS created_at
FROM actual_invoices ai
WHERE ai.status IN ('PENDING', 'ERROR', 'DEACTIVATED')
GROUP BY ai.meter_id, date_trunc('month', ai.period_start_date::date)::date
ON CONFLICT (meter_id, month_start) DO NOTHING;
