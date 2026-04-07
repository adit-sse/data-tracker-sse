-- Migration: Non-metered lines registration table
-- The non-metered equivalent of the `meters` table.
-- Each row represents a tracked (facility, supplier, utility category) combination.
-- Allows the coverage grid to show a line even before any invoice records exist.

CREATE TABLE public.non_metered_lines (
  id serial PRIMARY KEY,
  facility_id integer NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  utility_category_id integer NOT NULL REFERENCES public.utility_categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT non_metered_lines_unique
    UNIQUE (facility_id, supplier_id, utility_category_id)
);

-- RLS: same pattern as non_metered_records (access via facility → client)
ALTER TABLE public.non_metered_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "non_metered_lines_select"
  ON public.non_metered_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_lines.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "non_metered_lines_insert"
  ON public.non_metered_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_lines.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "non_metered_lines_update"
  ON public.non_metered_lines FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_lines.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_lines.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "non_metered_lines_delete"
  ON public.non_metered_lines FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_lines.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

-- Backfill: register a line for every existing distinct (facility, supplier, category)
-- combination already in non_metered_records. Skips rows with null supplier_id.
INSERT INTO public.non_metered_lines (facility_id, supplier_id, utility_category_id)
SELECT DISTINCT facility_id, supplier_id, utility_category_id
FROM public.non_metered_records
WHERE supplier_id IS NOT NULL
ON CONFLICT DO NOTHING;
