-- RLS for meter_month_slots.
--
-- 018 created the table without row level security. Browser-facing routes
-- (app/api/clients/[id]/coverage, app/api/activity/stuck) read it through the
-- cookie-scoped anon client, so RLS is the tenant boundary — without it any
-- authenticated user can read and write every client's slots.
--
-- Split out of 018 because 018 is already applied in production and must not
-- be edited. Safe to run on its own, and idempotent.
--
-- Policies mirror actual_invoices in 002_auth_rls_membership.sql: access is
-- granted via the slot's meter → facility → client membership chain.
-- Ingestion routes use the service role and bypass these by design.

ALTER TABLE public.meter_month_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meter_month_slots_select" ON public.meter_month_slots;
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

DROP POLICY IF EXISTS "meter_month_slots_insert" ON public.meter_month_slots;
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

DROP POLICY IF EXISTS "meter_month_slots_update" ON public.meter_month_slots;
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

DROP POLICY IF EXISTS "meter_month_slots_delete" ON public.meter_month_slots;
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
