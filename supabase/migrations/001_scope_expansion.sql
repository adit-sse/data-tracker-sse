-- Migration: Scope 1 & 3 Expansion
-- Run this manually via the Supabase SQL editor.

-- ============================================================
-- 1. Extend utility_categories with scope classification
-- ============================================================
ALTER TABLE public.utility_categories
  ADD COLUMN scope smallint NOT NULL DEFAULT 2 CHECK (scope IN (1, 2, 3)),
  ADD COLUMN is_metered boolean NOT NULL DEFAULT true,
  ADD COLUMN needs_review boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2. Facility groups (non-metered Scope 1 only)
--    A group = set of facilities that always appear together
--    on the same invoice from a given supplier.
-- ============================================================
CREATE TABLE public.facility_groups (
  id serial PRIMARY KEY,
  client_id integer NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES public.suppliers(id),
  name character varying NOT NULL
);

-- ============================================================
-- 3. Facility group members (junction table)
--    A facility can belong to multiple groups (one per supplier).
-- ============================================================
CREATE TABLE public.facility_group_members (
  id serial PRIMARY KEY,
  group_id integer NOT NULL REFERENCES public.facility_groups(id) ON DELETE CASCADE,
  facility_id integer NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  CONSTRAINT facility_group_members_unique UNIQUE (group_id, facility_id)
);

-- ============================================================
-- 4. Non-metered records
--    Covers Scope 1 non-metered (fuel, LPG, oil, etc.) and
--    is generic enough for Scope 3 via utility_category_id.
-- ============================================================
CREATE TABLE public.non_metered_records (
  id serial PRIMARY KEY,
  facility_id integer NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  supplier_id integer REFERENCES public.suppliers(id),
  utility_category_id integer NOT NULL REFERENCES public.utility_categories(id),

  -- Invoice fields
  invoice_number character varying,
  invoice_date date,
  period_start_date date NOT NULL,
  period_end_date date NOT NULL,

  -- Consumption (optional, unit varies per record not per category)
  consumption numeric,
  unit character varying,
  amount numeric,

  -- NGERS passthrough fields (stored, not queried, used on re-export)
  sub_category character varying,
  input_type character varying,
  framework character varying,
  version character varying,
  customer character varying,

  -- Status
  status character varying NOT NULL DEFAULT 'IMPORTED'
    CHECK (status IN ('IMPORTED', 'INFERRED_EMPTY', 'MANUAL')),

  -- Audit trail: if INFERRED_EMPTY, points to the real record that triggered it
  inferred_from_id integer REFERENCES public.non_metered_records(id),

  -- Unique per facility + supplier + category + period
  -- (a facility can have Diesel AND LPG from the same supplier in the same period)
  CONSTRAINT non_metered_records_unique
    UNIQUE (facility_id, supplier_id, utility_category_id, period_start_date, period_end_date)
);
