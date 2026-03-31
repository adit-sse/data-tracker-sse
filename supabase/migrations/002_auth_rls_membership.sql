-- Auth, membership, and RLS for invoice-tracker
-- Prerequisites: Supabase Auth enabled; disable public sign-up in Dashboard → Authentication → Providers
-- After running: insert your first admin, then assign users to clients (see bottom comments).
--
-- Assumes public.clients.id is INTEGER (matches facility_groups / your app routes).
-- If your clients.id is UUID, change client_members.client_id and user_can_access_client() accordingly.

-- ============================================================
-- 1. Profiles (one row per auth user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Sync profile on sign-up (admin-created users still get a row when they first exist in auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================
-- 2. App admins (who can manage client_members and create clients)
--    Populate only via SQL Editor or service role — not from the app.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies for authenticated: only service role / postgres can read/write.

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_admins a WHERE a.user_id = auth.uid()
  );
$$;

-- ============================================================
-- 3. Client membership
-- ============================================================
CREATE TABLE IF NOT EXISTS public.client_members (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  client_id integer NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_members_client_id ON public.client_members (client_id);

ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_members_select"
  ON public.client_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_app_admin());

CREATE POLICY "client_members_write_admin"
  ON public.client_members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_app_admin());

CREATE POLICY "client_members_update_admin"
  ON public.client_members FOR UPDATE
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY "client_members_delete_admin"
  ON public.client_members FOR DELETE
  TO authenticated
  USING (public.is_app_admin());

-- ============================================================
-- 4. Access helper (member of client OR app admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_can_access_client(cid integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_app_admin()
  OR EXISTS (
    SELECT 1 FROM public.client_members m
    WHERE m.user_id = auth.uid() AND m.client_id = cid
  );
$$;

-- ============================================================
-- 5. RLS on domain tables
-- ============================================================

-- ---------- clients ----------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_select"
  ON public.clients FOR SELECT
  TO authenticated
  USING (public.user_can_access_client(id));

CREATE POLICY "clients_insert_admin"
  ON public.clients FOR INSERT
  TO authenticated
  WITH CHECK (public.is_app_admin());

CREATE POLICY "clients_update_member"
  ON public.clients FOR UPDATE
  TO authenticated
  USING (public.user_can_access_client(id))
  WITH CHECK (public.user_can_access_client(id));

CREATE POLICY "clients_delete_admin"
  ON public.clients FOR DELETE
  TO authenticated
  USING (public.is_app_admin());

-- ---------- facilities ----------
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facilities_select"
  ON public.facilities FOR SELECT
  TO authenticated
  USING (public.user_can_access_client(client_id));

CREATE POLICY "facilities_insert"
  ON public.facilities FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_client(client_id));

CREATE POLICY "facilities_update"
  ON public.facilities FOR UPDATE
  TO authenticated
  USING (public.user_can_access_client(client_id))
  WITH CHECK (public.user_can_access_client(client_id));

CREATE POLICY "facilities_delete"
  ON public.facilities FOR DELETE
  TO authenticated
  USING (public.user_can_access_client(client_id));

-- ---------- suppliers & utility_categories (reference data) ----------
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suppliers_select_auth"
  ON public.suppliers FOR SELECT
  TO authenticated
  USING (true);

-- Inserts during invoice upload (find-or-create); shared catalogue across clients.
CREATE POLICY "suppliers_insert_auth"
  ON public.suppliers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "suppliers_update_admin"
  ON public.suppliers FOR UPDATE
  TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY "suppliers_delete_admin"
  ON public.suppliers FOR DELETE
  TO authenticated
  USING (public.is_app_admin());

CREATE POLICY "utility_categories_select_auth"
  ON public.utility_categories FOR SELECT
  TO authenticated
  USING (true);

-- Upload flow creates categories and may PATCH scope / is_metered on existing rows.
CREATE POLICY "utility_categories_insert_auth"
  ON public.utility_categories FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "utility_categories_update_auth"
  ON public.utility_categories FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "utility_categories_delete_admin"
  ON public.utility_categories FOR DELETE
  TO authenticated
  USING (public.is_app_admin());

-- ---------- meters ----------
ALTER TABLE public.meters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meters_select"
  ON public.meters FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = meters.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "meters_insert"
  ON public.meters FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = meters.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "meters_update"
  ON public.meters FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = meters.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = meters.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "meters_delete"
  ON public.meters FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = meters.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

-- ---------- actual_invoices ----------
ALTER TABLE public.actual_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "actual_invoices_select"
  ON public.actual_invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = actual_invoices.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "actual_invoices_insert"
  ON public.actual_invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = actual_invoices.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "actual_invoices_update"
  ON public.actual_invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = actual_invoices.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = actual_invoices.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "actual_invoices_delete"
  ON public.actual_invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meters m
      JOIN public.facilities f ON f.id = m.facility_id
      WHERE m.id = actual_invoices.meter_id
        AND public.user_can_access_client(f.client_id)
    )
  );

-- ---------- non_metered_records ----------
ALTER TABLE public.non_metered_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "non_metered_select"
  ON public.non_metered_records FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_records.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "non_metered_insert"
  ON public.non_metered_records FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_records.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "non_metered_update"
  ON public.non_metered_records FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_records.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_records.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

CREATE POLICY "non_metered_delete"
  ON public.non_metered_records FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facilities f
      WHERE f.id = non_metered_records.facility_id
        AND public.user_can_access_client(f.client_id)
    )
  );

-- ---------- facility_groups ----------
ALTER TABLE public.facility_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facility_groups_select"
  ON public.facility_groups FOR SELECT
  TO authenticated
  USING (public.user_can_access_client(client_id));

CREATE POLICY "facility_groups_insert"
  ON public.facility_groups FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_access_client(client_id));

CREATE POLICY "facility_groups_update"
  ON public.facility_groups FOR UPDATE
  TO authenticated
  USING (public.user_can_access_client(client_id))
  WITH CHECK (public.user_can_access_client(client_id));

CREATE POLICY "facility_groups_delete"
  ON public.facility_groups FOR DELETE
  TO authenticated
  USING (public.user_can_access_client(client_id));

-- ---------- facility_group_members ----------
ALTER TABLE public.facility_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "facility_group_members_select"
  ON public.facility_group_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_groups g
      WHERE g.id = facility_group_members.group_id
        AND public.user_can_access_client(g.client_id)
    )
  );

CREATE POLICY "facility_group_members_insert"
  ON public.facility_group_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility_groups g
      WHERE g.id = facility_group_members.group_id
        AND public.user_can_access_client(g.client_id)
    )
  );

CREATE POLICY "facility_group_members_update"
  ON public.facility_group_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_groups g
      WHERE g.id = facility_group_members.group_id
        AND public.user_can_access_client(g.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.facility_groups g
      WHERE g.id = facility_group_members.group_id
        AND public.user_can_access_client(g.client_id)
    )
  );

CREATE POLICY "facility_group_members_delete"
  ON public.facility_group_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.facility_groups g
      WHERE g.id = facility_group_members.group_id
        AND public.user_can_access_client(g.client_id)
    )
  );

-- ============================================================
-- BOOTSTRAP (run manually in SQL Editor after migration)
-- ============================================================
-- 1) Create your user in Dashboard → Authentication → Users → Add user
-- 2) Promote to app admin:
--    INSERT INTO public.app_admins (user_id) VALUES ('<your-auth-user-uuid>');
-- 3) Grant access to clients:
--    INSERT INTO public.client_members (user_id, client_id) VALUES
--      ('<user-uuid>', 25),
--      ('<other-user-uuid>', 25);
--
-- NEXT.JS: use @supabase/ssr createServerClient with cookies so API routes run as authenticated.
-- INGESTION / automation routes that must run without a browser session: use service role client
-- (SUPABASE_SECRET_KEY sb_secret_... or legacy SUPABASE_SERVICE_ROLE_KEY) only on the server — never in the browser.
