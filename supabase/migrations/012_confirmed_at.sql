-- Migration 012: Add confirmed_at timestamp to invoice tables
--
-- Enables the coverage table tooltip to show when a record was confirmed
-- (distinct from created_at, which records when the PENDING record was first received).
--
-- actual_invoices: used by metered (Scope 2) coverage grid
-- non_metered_records: used by non-metered (Scope 1/3) coverage grid

ALTER TABLE public.actual_invoices
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE public.non_metered_records
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
