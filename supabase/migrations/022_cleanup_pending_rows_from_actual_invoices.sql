-- Remove PENDING and ERROR rows from actual_invoices now that meter_month_slots
-- is the source of truth for workflow state.
--
-- IRREVERSIBLE. Run only after ALL of:
--   1. 018 applied (slots table exists)
--   2. 020 applied (RLS enabled)
--   3. The slot-writing code is deployed — otherwise the old code keeps
--      creating PENDING rows here and this deletes them again
--   4. 021 applied (drift re-backfilled) and slot counts verified
--
-- Skipping step 4 discards the workflow state of every PENDING row created
-- between 018's original backfill and the deploy.

DELETE FROM actual_invoices
WHERE status IN ('PENDING', 'ERROR');
