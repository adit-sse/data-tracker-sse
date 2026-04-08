-- Migration 008: Replace utility_categories with input_types + categories
--
-- Model change:
--   utility_categories  →  input_types  (rename; same data, same FK relationships)
--   (new)               →  categories   (NGERS groupings: Stationary Energy, Transport, …)
--
-- Scope rules:
--   Scope 1 & 3: have both category_id + input_type_id
--   Scope 2:     input_type_id only (category is always implicit "Electricity")

-- -------------------------------------------------------
-- 1. Create categories table
-- -------------------------------------------------------
CREATE TABLE public.categories (
  id   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name text        NOT NULL UNIQUE,
  scope smallint   NOT NULL CHECK (scope IN (1, 3)),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select_auth"
  ON public.categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "categories_insert_auth"
  ON public.categories FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "categories_update_auth"
  ON public.categories FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "categories_delete_admin"
  ON public.categories FOR DELETE TO authenticated
  USING (public.is_app_admin());

-- -------------------------------------------------------
-- 2. Rename utility_categories → input_types
-- -------------------------------------------------------
ALTER TABLE public.utility_categories RENAME TO input_types;

-- -------------------------------------------------------
-- 3. Rename utility_category_id columns across all tables
-- -------------------------------------------------------
ALTER TABLE public.meters
  RENAME COLUMN utility_category_id TO input_type_id;

ALTER TABLE public.non_metered_lines
  RENAME COLUMN utility_category_id TO input_type_id;

ALTER TABLE public.non_metered_records
  RENAME COLUMN utility_category_id TO input_type_id;

ALTER TABLE public.facility_group_members
  RENAME COLUMN utility_category_id TO input_type_id;

ALTER TABLE public.facility_groups
  RENAME COLUMN utility_category_id TO input_type_id;

-- -------------------------------------------------------
-- 4. Add category_id FK to meters and non_metered_lines
-- -------------------------------------------------------
ALTER TABLE public.meters
  ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE public.non_metered_lines
  ADD COLUMN category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

-- -------------------------------------------------------
-- 5. Drop sub_category text column from non_metered_lines
--    (replaced by the category_id FK above)
-- -------------------------------------------------------
ALTER TABLE public.non_metered_lines DROP COLUMN IF EXISTS sub_category;
