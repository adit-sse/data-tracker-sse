-- Migration 006: Add is_active column to non_metered_lines table
-- Allows explicit active/inactive toggle for non-metered lines

ALTER TABLE public.non_metered_lines
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
