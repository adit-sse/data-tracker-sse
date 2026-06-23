-- Migration 014: Event log triage (status + custom tags)
--
-- User-facing workflow metadata for ingestion_events rows shown on the Ingestion
-- Overview event log. Separate from the append-only audit log itself.
--
--   * ingestion_event_triage  — one row per event: workflow status + optional note
--   * ingestion_event_custom_tags — zero or more free-form labels per event
--
-- No row in triage = "unreviewed" (implicit default in the app).
-- Access mirrors ingestion_events: admins see all; members see events for their clients.

-- ============================================================
-- Helper: can the current user access this ingestion event?
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_can_access_ingestion_event(eid bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ingestion_events e
    WHERE e.id = eid
      AND (
        public.is_app_admin()
        OR (e.client_id IS NOT NULL AND public.user_can_access_client(e.client_id))
      )
  );
$$;

-- ============================================================
-- Workflow status (one per event)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingestion_event_triage (
  event_id    bigint PRIMARY KEY REFERENCES public.ingestion_events (id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'unreviewed',
  note        text,
  updated_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingestion_event_triage_status_check
    CHECK (status IN ('unreviewed', 'in_progress', 'addressed'))
);

CREATE INDEX IF NOT EXISTS ingestion_event_triage_status_idx
  ON public.ingestion_event_triage (status);

-- ============================================================
-- Custom tags (many per event)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingestion_event_custom_tags (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES public.ingestion_events (id) ON DELETE CASCADE,
  label       text NOT NULL,
  created_by  uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingestion_event_custom_tags_label_nonempty
    CHECK (length(trim(label)) > 0),
  CONSTRAINT ingestion_event_custom_tags_unique
    UNIQUE (event_id, label)
);

CREATE INDEX IF NOT EXISTS ingestion_event_custom_tags_event_id_idx
  ON public.ingestion_event_custom_tags (event_id);

CREATE INDEX IF NOT EXISTS ingestion_event_custom_tags_label_idx
  ON public.ingestion_event_custom_tags (label);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.ingestion_event_triage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_event_custom_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ingestion_event_triage_select"
  ON public.ingestion_event_triage FOR SELECT
  TO authenticated
  USING (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_triage_insert"
  ON public.ingestion_event_triage FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_triage_update"
  ON public.ingestion_event_triage FOR UPDATE
  TO authenticated
  USING (public.user_can_access_ingestion_event(event_id))
  WITH CHECK (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_triage_delete"
  ON public.ingestion_event_triage FOR DELETE
  TO authenticated
  USING (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_custom_tags_select"
  ON public.ingestion_event_custom_tags FOR SELECT
  TO authenticated
  USING (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_custom_tags_insert"
  ON public.ingestion_event_custom_tags FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_custom_tags_update"
  ON public.ingestion_event_custom_tags FOR UPDATE
  TO authenticated
  USING (public.user_can_access_ingestion_event(event_id))
  WITH CHECK (public.user_can_access_ingestion_event(event_id));

CREATE POLICY "ingestion_event_custom_tags_delete"
  ON public.ingestion_event_custom_tags FOR DELETE
  TO authenticated
  USING (public.user_can_access_ingestion_event(event_id));
