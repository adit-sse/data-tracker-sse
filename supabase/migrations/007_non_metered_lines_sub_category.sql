-- Migration 007: Add sub_category column to non_metered_lines table
-- Moves Category to line level for consistent row-level editing

ALTER TABLE public.non_metered_lines
  ADD COLUMN sub_category text;
