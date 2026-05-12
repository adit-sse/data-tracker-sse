-- Migration 011: Add ELECTRICITY as a Scope 2 Category
--
-- Rationale: The ingestion API receives ELECTRICITY as a category name in the
-- input format. Rather than keeping it solely as an input_type, we add it to
-- the categories table so it can be resolved via the category lookup path.
--
-- What this migration does:
--   1. Widens the categories.scope CHECK constraint to include scope 2
--   2. Inserts ELECTRICITY into categories (scope = 2)
--   3. Backfills category_id on meters and non_metered_lines for all rows
--      whose input_type points to ELECTRICITY
--
-- What this migration does NOT do:
--   - Remove ELECTRICITY from input_types (it remains there unchanged)
--   - Alter any input_type_id FK columns
--   - Touch non_metered_records (no category_id column on that table)

-- -------------------------------------------------------
-- 1. Widen scope CHECK constraint on categories
-- -------------------------------------------------------
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_scope_check;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_scope_check CHECK (scope IN (1, 2, 3));

-- -------------------------------------------------------
-- 2. Insert ELECTRICITY as a Scope 2 category
-- -------------------------------------------------------
INSERT INTO public.categories (name, scope)
VALUES ('ELECTRICITY', 2)
ON CONFLICT (name) DO NOTHING;

-- -------------------------------------------------------
-- 3. Backfill category_id on meters
-- -------------------------------------------------------
UPDATE public.meters
SET category_id = (SELECT id FROM public.categories WHERE name = 'ELECTRICITY')
WHERE input_type_id = (SELECT id FROM public.input_types WHERE name = 'ELECTRICITY')
  AND category_id IS NULL;

-- -------------------------------------------------------
-- 4. Backfill category_id on non_metered_lines
-- -------------------------------------------------------
UPDATE public.non_metered_lines
SET category_id = (SELECT id FROM public.categories WHERE name = 'ELECTRICITY')
WHERE input_type_id = (SELECT id FROM public.input_types WHERE name = 'ELECTRICITY')
  AND category_id IS NULL;
