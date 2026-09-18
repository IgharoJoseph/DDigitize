-- Management / CRM foundation and production security hardening.
-- Additive migration: no existing table or data is removed.

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'prospect')),
  industry text,
  email text,
  phone text,
  address text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  job_title text,
  email text,
  phone text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_clients (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  relationship text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_clients TO authenticated;
GRANT ALL ON public.clients, public.client_contacts, public.project_clients TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients readable" ON public.clients;
DROP POLICY IF EXISTS "clients managed" ON public.clients;
CREATE POLICY "clients readable by authorised users" ON public.clients
  FOR SELECT TO authenticated USING (
    public.is_app_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_clients pc
      JOIN public.project_members pm ON pm.project_id = pc.project_id
      WHERE pc.client_id = clients.id AND pm.user_id = auth.uid()
    )
  );
CREATE POLICY "clients managed by authorised users" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.is_app_admin(auth.uid()) AND created_by = auth.uid());
CREATE POLICY "clients updated by admin or linked manager" ON public.clients
  FOR UPDATE TO authenticated USING (
    public.is_app_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_clients pc
      WHERE pc.client_id = clients.id AND public.can_manage_project(auth.uid(), pc.project_id)
    )
  );
CREATE POLICY "clients deleted by admin" ON public.clients
  FOR DELETE TO authenticated USING (public.is_app_admin(auth.uid()));

CREATE POLICY "contacts readable by authorised users" ON public.client_contacts
  FOR SELECT TO authenticated USING (
    public.is_app_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_clients pc
      JOIN public.project_members pm ON pm.project_id = pc.project_id
      WHERE pc.client_id = client_contacts.client_id AND pm.user_id = auth.uid()
    )
  );
CREATE POLICY "contacts managed by admin or project manager" ON public.client_contacts
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid() AND (
      public.is_app_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.project_clients pc WHERE pc.client_id = client_contacts.client_id AND public.can_manage_project(auth.uid(), pc.project_id))
    )
  );
CREATE POLICY "contacts updated by admin or project manager" ON public.client_contacts
  FOR UPDATE TO authenticated USING (
    public.is_app_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_clients pc WHERE pc.client_id = client_contacts.client_id AND public.can_manage_project(auth.uid(), pc.project_id))
  );
CREATE POLICY "contacts deleted by admin or project manager" ON public.client_contacts
  FOR DELETE TO authenticated USING (
    public.is_app_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_clients pc WHERE pc.client_id = client_contacts.client_id AND public.can_manage_project(auth.uid(), pc.project_id))
  );

CREATE POLICY "project clients readable by members" ON public.project_clients
  FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "project clients managed by project managers" ON public.project_clients
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "project clients updated by project managers" ON public.project_clients
  FOR UPDATE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "project clients deleted by project managers" ON public.project_clients
  FOR DELETE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));

CREATE INDEX IF NOT EXISTS clients_status_idx ON public.clients(status);
CREATE INDEX IF NOT EXISTS clients_name_idx ON public.clients(name);
CREATE INDEX IF NOT EXISTS client_contacts_client_idx ON public.client_contacts(client_id);
CREATE INDEX IF NOT EXISTS project_clients_client_idx ON public.project_clients(client_id);

CREATE OR REPLACE FUNCTION public.touch_client_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS clients_touch ON public.clients;
CREATE TRIGGER clients_touch BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.touch_client_updated_at();
DROP TRIGGER IF EXISTS client_contacts_touch ON public.client_contacts;
CREATE TRIGGER client_contacts_touch BEFORE UPDATE ON public.client_contacts FOR EACH ROW EXECUTE FUNCTION public.touch_client_updated_at();

-- Stop future accounts from receiving platform-admin automatically. Existing admins remain unchanged.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'contributor') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- No anonymous access to application data.
REVOKE ALL ON public.clients, public.client_contacts, public.project_clients FROM anon;
REVOKE SELECT ON public.features, public.feature_categories, public.category_fields,
  public.imagery_datasets, public.activity_log, public.profiles, public.projects,
  public.project_members, public.work_areas, public.area_assignments FROM anon;

-- Harden SECURITY DEFINER helper functions against search_path manipulation.
ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public;
ALTER FUNCTION public.is_app_admin(uuid) SET search_path = public;
ALTER FUNCTION public.project_role_of(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.is_project_member(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.can_manage_project(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.can_review_project(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.is_assigned_to_area(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.can_digitize_in(uuid, uuid, uuid) SET search_path = public;

-- Reassert the production permission boundaries in case older policies are present.
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles readable" ON public.profiles;
CREATE POLICY "profiles readable by self admins and teammates" ON public.profiles
  FOR SELECT TO authenticated USING (
    id = auth.uid()
    OR public.is_app_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.project_members mine
      JOIN public.project_members teammate ON teammate.project_id = mine.project_id
      WHERE mine.user_id = auth.uid() AND teammate.user_id = profiles.id
    )
  );

DROP POLICY IF EXISTS "members managed update" ON public.project_members;
CREATE POLICY "members managed update" ON public.project_members
  FOR UPDATE TO authenticated USING (
    public.can_manage_project(auth.uid(), project_id) AND user_id <> auth.uid()
  ) WITH CHECK (
    public.can_manage_project(auth.uid(), project_id) AND user_id <> auth.uid()
  );

DROP POLICY IF EXISTS "members managed delete" ON public.project_members;
CREATE POLICY "members managed delete" ON public.project_members
  FOR DELETE TO authenticated USING (
    public.can_manage_project(auth.uid(), project_id) AND user_id <> auth.uid()
  );

DROP POLICY IF EXISTS "areas updated by assigned contributor" ON public.work_areas;

-- Database-level workflow guards: approved features are immutable to contributors,
-- and a contributor cannot mark their own work as verified.
CREATE OR REPLACE FUNCTION public.guard_feature_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'verified' AND NOT public.can_review_project(auth.uid(), OLD.project_id) THEN
    RAISE EXCEPTION 'Approved features are locked';
  END IF;
  IF NEW.status = 'verified' AND NOT public.can_review_project(auth.uid(), NEW.project_id) THEN
    RAISE EXCEPTION 'Only reviewers can approve features';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_feature_workflow ON public.features;
CREATE TRIGGER guard_feature_workflow
BEFORE UPDATE ON public.features
FOR EACH ROW EXECUTE FUNCTION public.guard_feature_workflow();

CREATE INDEX IF NOT EXISTS features_project_status_idx ON public.features(project_id, status);
CREATE INDEX IF NOT EXISTS features_project_updated_idx ON public.features(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS work_areas_project_status_idx ON public.work_areas(project_id, status);
CREATE INDEX IF NOT EXISTS project_members_project_role_idx ON public.project_members(project_id, role);
CREATE INDEX IF NOT EXISTS activity_project_created_idx ON public.activity_log(project_id, created_at DESC);
