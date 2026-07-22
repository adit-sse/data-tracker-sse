-- meter_month_slots: one row per meter × calendar month
-- Tracks workflow state (PENDING = data expected, ERROR = ingestion failed, DEACTIVATED = meter off).
-- Coverage completeness (31/31 days) is always derived from meter_coverage_segments — never stored here.

CREATE TABLE meter_month_slots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id    integer     NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
  month_start date        NOT NULL,  -- always YYYY-MM-01
  status      text        NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'ERROR', 'DEACTIVATED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meter_id, month_start)
);

CREATE INDEX meter_month_slots_meter_id_idx ON meter_month_slots (meter_id);
CREATE INDEX meter_month_slots_month_start_idx ON meter_month_slots (month_start);

-- ============================================================
-- RLS — mirrors the actual_invoices policies in 002_auth_rls_membership.sql.
-- Required: browser-facing routes (coverage, activity/stuck) read this table
-- through the cookie-scoped anon client, so RLS is the tenant boundary.
-- Without it, any authenticated user could read and write every client's slots.
-- Ingestion routes use the service role and bypass these by design.
-- ============================================================
ALTER TABLE public.meter_month_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meter_month_slots_select"
  ON public.meter_month_slots FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = meter_month_slots.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "meter_month_slots_insert"
  ON public.meter_month_slots FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = meter_month_slots.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "meter_month_slots_update"
  ON public.meter_month_slots FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = meter_month_slots.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = meter_month_slots.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "meter_month_slots_delete"
  ON public.meter_month_slots FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = meter_month_slots.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

-- Backfill from existing actual_invoices non-CONFIRMED rows.
-- Priority: ERROR > DEACTIVATED > PENDING (most severe status wins per month).
INSERT INTO meter_month_slots (meter_id, month_start, status, created_at)
SELECT
  ai.meter_id,
  date_trunc('month', ai.period_start_date::date)::date AS month_start,
  CASE
    WHEN bool_or(ai.status = 'ERROR')       THEN 'ERROR'
    WHEN bool_or(ai.status = 'DEACTIVATED')
     AND NOT bool_or(ai.status = 'PENDING') THEN 'DEACTIVATED'
    ELSE 'PENDING'
  END AS status,
  now() AS created_at
FROM actual_invoices ai
WHERE ai.status IN ('PENDING', 'ERROR', 'DEACTIVATED')
GROUP BY ai.meter_id, date_trunc('month', ai.period_start_date::date)::date
ON CONFLICT (meter_id, month_start) DO NOTHING;
