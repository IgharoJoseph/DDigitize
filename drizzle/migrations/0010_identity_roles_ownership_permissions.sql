-- 1. Project ownership as a first-class concept -------------------------------
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);
UPDATE public.projects SET owner_id = created_by WHERE owner_id IS NULL;
CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON public.projects(owner_id);

-- 2. Reviewer stamp on features (server-set only) -----------------------------
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id);
ALTER TABLE public.features ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 3. Identity helpers ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_owner(_user_id) OR public.is_app_admin(_user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_org_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'manager'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_project_owner(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND owner_id = _user_id AND _user_id IS NOT NULL
  )
$$;

-- 4. The permission matrix — the single source of truth ----------------------
-- Permissions: view, create, edit, delete, submit, review, approve,
-- request_changes, reopen, export, manage, assign.
CREATE OR REPLACE FUNCTION public.has_project_permission(
  _user_id uuid, _project_id uuid, _permission text
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.project_role;
BEGIN
  IF _user_id IS NULL OR _permission IS NULL THEN RETURN false; END IF;

  -- Platform administration and project ownership: full control.
  IF public.is_platform_admin(_user_id) THEN RETURN true; END IF;
  IF _project_id IS NOT NULL AND public.is_project_owner(_user_id, _project_id) THEN
    RETURN true;
  END IF;

  -- Organisation-wide manager: operational oversight on every project,
  -- but no destructive control and no digitising rights of its own.
  IF public.is_org_manager(_user_id) AND _permission IN (
    'view','export','review','approve','request_changes','reopen','assign','manage'
  ) THEN
    RETURN true;
  END IF;

  IF _project_id IS NULL THEN RETURN false; END IF;
  v_role := public.project_role_of(_user_id, _project_id);
  IF v_role IS NULL THEN RETURN false; END IF;

  RETURN CASE v_role
    WHEN 'manager' THEN _permission IN (
      'view','create','edit','delete','submit','review','approve',
      'request_changes','reopen','manage','assign')
    WHEN 'supervisor' THEN _permission IN (
      'view','create','edit','submit','review','approve',
      'request_changes','reopen','assign')
    WHEN 'contributor' THEN _permission IN ('view','create','edit','submit','delete')
    ELSE false
  END;
END;
$$;

-- Permission list for the signed-in user, so the interface can mirror the
-- database rules instead of guessing them from a role name.
CREATE OR REPLACE FUNCTION public.project_permissions(_project_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(p ORDER BY p), ARRAY[]::text[])
  FROM unnest(ARRAY['view','create','edit','delete','submit','review','approve',
                    'request_changes','reopen','export','manage','assign']) AS p
  WHERE public.has_project_permission(auth.uid(), _project_id, p)
$$;

-- 5. Existing helpers now derive from the matrix (no parallel rule set) ------
CREATE OR REPLACE FUNCTION public.can_manage_project(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_project_permission(_user_id, _project_id, 'manage')
$$;

CREATE OR REPLACE FUNCTION public.can_review_project(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_project_permission(_user_id, _project_id, 'review')
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id)
     OR public.is_org_manager(_user_id)
     OR public.is_project_owner(_user_id, _project_id)
     OR EXISTS (
       SELECT 1 FROM public.project_members
       WHERE user_id = _user_id AND project_id = _project_id
     )
$$;

-- Digitising scope: the right to create geometry AND the spatial assignment.
CREATE OR REPLACE FUNCTION public.can_digitize_in(_user_id uuid, _project_id uuid, _work_area_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_project_permission(_user_id, _project_id, 'create')
     AND (
       public.has_project_permission(_user_id, _project_id, 'review')
       OR (
         _work_area_id IS NOT NULL
         AND public.is_assigned_to_area(_user_id, _work_area_id)
         AND EXISTS (
           SELECT 1 FROM public.work_areas
           WHERE id = _work_area_id AND project_id = _project_id
         )
       )
     )
$$;

CREATE OR REPLACE FUNCTION public.app_rank(_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.is_owner(_user_id) THEN 100
    WHEN public.is_app_admin(_user_id) THEN 90
    WHEN public.is_org_manager(_user_id) THEN 60
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.project_authority(_user_id uuid, _project_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(
    public.app_rank(_user_id),
    CASE WHEN public.is_project_owner(_user_id, _project_id) THEN 80 ELSE 0 END,
    COALESCE(public.role_rank(public.project_role_of(_user_id, _project_id)), 0)
  )
$$;

-- 6. Registration no longer hands out administration -------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    lower(COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
  )
  ON CONFLICT (id) DO NOTHING;

  -- Every new account starts as a contributor with no project access.
  -- Platform administration is granted explicitly, never by being first.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'contributor')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- 7. Protected columns --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_project_ownership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND NOT (public.is_platform_admin(auth.uid()) OR OLD.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only a platform administrator or the current project owner can transfer ownership'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'The creator of a project cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_guard_ownership ON public.projects;
CREATE TRIGGER projects_guard_ownership BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.guard_project_ownership();

CREATE OR REPLACE FUNCTION public.guard_feature_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  can_review boolean;
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := uid;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    IF NEW.status IS DISTINCT FROM 'draft'
       AND NOT public.has_project_permission(uid, NEW.project_id, 'review') THEN
      NEW.status := 'draft';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'The author of a feature cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'A feature cannot be moved to another project'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reviewer stamps are server-set; client values are ignored.
  NEW.reviewed_by := OLD.reviewed_by;
  NEW.reviewed_at := OLD.reviewed_at;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    can_review := public.has_project_permission(uid, NEW.project_id, 'review');

    IF OLD.status = 'verified'
       AND NOT public.has_project_permission(uid, NEW.project_id, 'reopen') THEN
      RAISE EXCEPTION 'Approved work can only be reopened by a reviewer'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'verified'
       AND NOT public.has_project_permission(uid, NEW.project_id, 'approve') THEN
      RAISE EXCEPTION 'Only a reviewer can approve work'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'under_review' AND NOT can_review THEN
      RAISE EXCEPTION 'Only a reviewer can put work under review'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'needs_revision'
       AND NOT public.has_project_permission(uid, NEW.project_id, 'request_changes') THEN
      RAISE EXCEPTION 'Only a reviewer can request changes'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status IN ('draft', 'submitted')
       AND NOT (OLD.created_by = uid OR can_review) THEN
      RAISE EXCEPTION 'Only the author or a reviewer can change this status'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF can_review AND OLD.created_by <> uid THEN
      NEW.reviewed_by := uid;
      NEW.reviewed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS features_guard_fields ON public.features;
CREATE TRIGGER features_guard_fields BEFORE INSERT OR UPDATE ON public.features
FOR EACH ROW EXECUTE FUNCTION public.guard_feature_fields();

-- 8. Policies that referenced the old app-admin shortcut ---------------------
DROP POLICY IF EXISTS "projects created by admin" ON public.projects;
CREATE POLICY "projects created by platform admin or manager" ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
  (public.is_platform_admin(auth.uid()) OR public.is_org_manager(auth.uid()))
  AND created_by = auth.uid()
  AND (owner_id IS NULL OR owner_id = auth.uid() OR public.is_platform_admin(auth.uid()))
);

DROP POLICY IF EXISTS "projects deleted by owner" ON public.projects;
CREATE POLICY "projects deleted by platform admin or project owner" ON public.projects
FOR DELETE TO authenticated
USING (public.is_platform_admin(auth.uid()) OR public.is_project_owner(auth.uid(), id));

-- Assignments may only target people who are actually project members.
DROP POLICY IF EXISTS "assignments managed insert" ON public.area_assignments;
CREATE POLICY "assignments managed insert" ON public.area_assignments
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.work_areas wa
    WHERE wa.id = area_assignments.work_area_id
      AND public.has_project_permission(auth.uid(), wa.project_id, 'assign')
      AND EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.project_id = wa.project_id AND pm.user_id = area_assignments.user_id
      )
  )
);

-- 9. Execution rights --------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.has_project_permission(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_permissions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_org_manager(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_project_owner(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_feature_fields() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.guard_project_ownership() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_project_permission(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_permissions(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_manager(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_owner(uuid, uuid) TO authenticated, service_role;