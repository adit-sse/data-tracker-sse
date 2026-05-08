-- Migration: Add created_at to non_metered_records
-- Backfill strategy (based on period dates, dynamic relative to NOW()):
--   • Period ends before April 2026  → created_at = now() - 37 days (> 1 month + 1 week old → ages to dark)
--   • Period overlaps April 2026     → created_at = now() - 14 days  (recent → stays light)
--   • Period starts May 2026 onward  → created_at = now()            (fresh)

-- Step 1: Add the column as nullable so we can backfill before enforcing NOT NULL.
ALTER TABLE public.non_metered_records
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- Step 2: Backfill all rows (safe to re-run — overwrites existing values).
UPDATE public.non_metered_records
SET created_at = CASE
  -- Period entirely before April 2026 (pre-April months → aged / dark)
  WHEN period_end_date < DATE '2026-04-01'
    THEN now() - INTERVAL '37 days'
  -- Period overlaps April 2026 (starts before or in April, ends in April or later)
  WHEN period_start_date < DATE '2026-05-01'
    AND period_end_date  >= DATE '2026-04-01'
    THEN now() - INTERVAL '14 days'
  -- Period starts May 2026 or later (fresh)
  ELSE now()
END;

-- Step 3: Enforce NOT NULL with a default for all future inserts.
ALTER TABLE public.non_metered_records
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now();
