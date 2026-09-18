-- 1. The project owner: the single account with ultimate authority.
CREATE TABLE IF NOT EXISTS public.app_owners (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_owners TO authenticated;
GRANT ALL ON public.app_owners TO service_role;

ALTER TABLE public.app_owners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner readable by authenticated" ON public.app_owners;
CREATE POLICY "owner readable by authenticated"
  ON public.app_owners FOR SELECT TO authenticated USING (true);

-- Backfill: the earliest admin account becomes the owner.
INSERT INTO public.app_owners (user_id)
SELECT ur.user_id
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE ur.role = 'admin'
ORDER BY u.created_at
LIMIT 1
ON CONFLICT DO NOTHING;

-- 2. Authority helpers on one shared scale.
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_owners WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.role_rank(_role project_role)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _role
    WHEN 'manager' THEN 50
    WHEN 'supervisor' THEN 30
    WHEN 'contributor' THEN 10
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.app_rank(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_owner(_user_id) THEN 100
    WHEN public.is_app_admin(_user_id) THEN 90
    ELSE 0 END
$$;

-- Highest authority a user holds over a project: app-wide or project role.
CREATE OR REPLACE FUNCTION public.project_authority(_user_id uuid, _project_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    public.app_rank(_user_id),
    COALESCE(public.role_rank(public.project_role_of(_user_id, _project_id)), 0)
  )
$$;

-- 3. Project membership: you may only grant or remove roles below your own.
DROP POLICY IF EXISTS "members managed insert" ON public.project_members;
DROP POLICY IF EXISTS "members managed update" ON public.project_members;
DROP POLICY IF EXISTS "members managed delete" ON public.project_members;

CREATE POLICY "members granted below own authority"
  ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (
    public.project_authority(auth.uid(), project_id) >= 50
    AND public.project_authority(auth.uid(), project_id) > public.role_rank(role)
  );

CREATE POLICY "members changed below own authority"
  ON public.project_members FOR UPDATE TO authenticated
  USING (
    public.project_authority(auth.uid(), project_id) >= 50
    AND public.project_authority(auth.uid(), project_id) > public.role_rank(role)
    AND NOT public.is_owner(user_id)
  )
  WITH CHECK (
    public.project_authority(auth.uid(), project_id) > public.role_rank(role)
  );

CREATE POLICY "members removed below own authority"
  ON public.project_members FOR DELETE TO authenticated
  USING (
    public.project_authority(auth.uid(), project_id) >= 50
    AND public.project_authority(auth.uid(), project_id) > public.role_rank(role)
    AND NOT public.is_owner(user_id)
  );

-- 4. Supervisors may assign and reassign contributors to work areas.
DROP POLICY IF EXISTS "assignments managed insert" ON public.area_assignments;
DROP POLICY IF EXISTS "assignments managed delete" ON public.area_assignments;

CREATE POLICY "assignments managed insert"
  ON public.area_assignments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.work_areas wa
    WHERE wa.id = area_assignments.work_area_id
      AND public.can_review_project(auth.uid(), wa.project_id)
  ));

CREATE POLICY "assignments managed delete"
  ON public.area_assignments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.work_areas wa
    WHERE wa.id = area_assignments.work_area_id
      AND public.can_review_project(auth.uid(), wa.project_id)
  ));

-- 5. Projects may not be deleted by ordinary admins, only by the owner.
DROP POLICY IF EXISTS "projects deleted by admin" ON public.projects;
CREATE POLICY "projects deleted by owner"
  ON public.projects FOR DELETE TO authenticated
  USING (public.is_owner(auth.uid()));

-- 6. The first account to sign up becomes the owner as well as admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_count int;
BEGIN
  INSERT INTO public.profiles (id, email, display_name, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    lower(COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO admin_count FROM public.user_roles WHERE role = 'admin';
  IF admin_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.app_owners (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'contributor') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
