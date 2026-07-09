-- Remove PENDING and ERROR rows from actual_invoices now that meter_month_slots
-- is the source of truth for workflow state.
-- Run this AFTER 018_meter_month_slots.sql has been applied and slots are confirmed correct.

DELETE FROM actual_invoices
WHERE status IN ('PENDING', 'ERROR');
