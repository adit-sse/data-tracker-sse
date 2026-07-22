-- facility_aliases: alternative names a facility is known by in source data.
--
-- Some clients' NGERS exports put something other than the facility name in the
-- Facility column — Fredon sends the site's street address, and one facility can
-- cover several addresses (Fredon ACT covers both Fyshwick tenancies plus Wagga
-- Wagga). facilities.address is a single column and cannot express that, hence a
-- separate many-to-one table.
--
-- Resolution order is: exact/fuzzy facility name → alias → 404. An unmapped alias
-- therefore fails loudly with "Facility ... not found" rather than being guessed
-- at or silently attached to the wrong facility.

CREATE TABLE public.facility_aliases (
  id          serial      PRIMARY KEY,
  facility_id integer     NOT NULL REFERENCES public.facilities (id) ON DELETE CASCADE,
  alias       text        NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Same alias cannot be listed twice against one facility. Aliases are NOT unique
-- per client at the database level — an index expression cannot reach through to
-- facilities.client_id — so lookup detects the two-facilities-one-alias case and
-- fails with an explicit error rather than silently picking one.
CREATE UNIQUE INDEX facility_aliases_facility_alias_idx
  ON public.facility_aliases (facility_id, lower(btrim(alias)));

CREATE INDEX facility_aliases_alias_idx ON public.facility_aliases (lower(btrim(alias)));

-- ============================================================
-- RLS — mirrors facilities in 002_auth_rls_membership.sql.
-- Ingestion routes use the service role and bypass these by design.
-- ============================================================
ALTER TABLE public.facility_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facility_aliases_select"
  ON public.facility_aliases FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = facility_aliases.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "facility_aliases_insert"
  ON public.facility_aliases FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = facility_aliases.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "facility_aliases_update"
  ON public.facility_aliases FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = facility_aliases.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = facility_aliases.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "facility_aliases_delete"
  ON public.facility_aliases FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = facility_aliases.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );
