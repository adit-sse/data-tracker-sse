-- Migration 005: Add is_active column to meters table
-- Allows explicit active/inactive toggle independent of service dates

ALTER TABLE public.meters
  ADD COLUMN is_active boolean NOT NULL DEFAULT true;
