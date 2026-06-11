-- Migration 013: Ingestion events log
--
-- Append-only audit log of every confirm/error ingestion attempt and its outcome.
-- Today, when a confirm fails, the reason only exists in the HTTP response sent back
-- to the automation (n8n) and in server console logs — nothing is persisted. This table
-- captures the "why" so a cross-client /activity page can surface failed/attempted confirms.
--
-- Notes:
--   * Raw client_name / supplier_name / facility_name / utility_name are stored as text
--     (not only FKs) so that lookup failures — e.g. "Client X not found" — are still logged
--     even when no client row resolves (client_id will be NULL in that case).
--   * Writes happen via the service-role client in the ingestion routes, which bypasses RLS.
--   * Reads are scoped by RLS: app admins see everything; members see events for clients they
--     can access. Events with a NULL client_id (unresolved lookups) are admin-only.

CREATE TABLE IF NOT EXISTS public.ingestion_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  endpoint        text NOT NULL,        -- 'confirm' | 'metered/confirm' | 'unified-confirm' | 'error' | 'metered/error'
  outcome         text NOT NULL,        -- 'SUCCESS' | 'FAILURE'
  scope_kind      text,                 -- 'metered' | 'non_metered' | 'group' | 'line' | NULL
  client_id       integer REFERENCES public.clients (id) ON DELETE SET NULL,
  client_name     text,                 -- raw value from payload (kept even if lookup failed)
  supplier_name   text,
  facility_name   text,
  utility_name    text,
  period_start    date,
  reason          text,                 -- error message on FAILURE
  http_status     integer,
  affected_count  integer,              -- confirmed / updated count on SUCCESS
  payload_excerpt jsonb,                -- trimmed request body for debugging
  duration_ms     integer,

  CONSTRAINT ingestion_events_outcome_check CHECK (outcome IN ('SUCCESS', 'FAILURE'))
);

CREATE INDEX IF NOT EXISTS ingestion_events_created_at_idx ON public.ingestion_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_events_outcome_idx ON public.ingestion_events (outcome);
CREATE INDEX IF NOT EXISTS ingestion_events_client_idx ON public.ingestion_events (client_id);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.ingestion_events ENABLE ROW LEVEL SECURITY;

-- Admins see all events; members see events for clients they can access.
-- Rows with NULL client_id (unresolved lookups) are visible to app admins only.
CREATE POLICY "ingestion_events_select"
  ON public.ingestion_events FOR SELECT
  TO authenticated
  USING (
    public.is_app_admin()
    OR (client_id IS NOT NULL AND public.user_can_access_client(client_id))
  );

-- No INSERT/UPDATE/DELETE policies for authenticated users: the log is written exclusively
-- by the service-role client in the ingestion routes (which bypasses RLS), and is append-only.
