-- Phase 1 security hardening. Additive only: no table, column, policy target or
-- data is removed beyond replacing the specific policies named below.

-- 1) Profile visibility -------------------------------------------------------
-- Helper: do two accounts share at least one project?
CREATE OR REPLACE FUNCTION public.shares_project(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members ma
    JOIN public.project_members mb ON mb.project_id = ma.project_id
    WHERE ma.user_id = _a AND mb.user_id = _b
  )
$$;

DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
CREATE POLICY "profiles readable by self admin or teammates"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_app_admin(auth.uid())
  OR public.shares_project(auth.uid(), id)
);

-- 2) Owner identity no longer public to every signed-in user ------------------
DROP POLICY IF EXISTS "owner readable by authenticated" ON public.app_owners;
CREATE POLICY "owner readable by self or admin"
ON public.app_owners FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_app_admin(auth.uid()));

-- 3) Nobody edits their own project membership -------------------------------
DROP POLICY IF EXISTS "members granted below own authority" ON public.project_members;
CREATE POLICY "members granted below own authority"
ON public.project_members FOR INSERT TO authenticated
WITH CHECK (
  public.project_authority(auth.uid(), project_id) >= 50
  AND public.project_authority(auth.uid(), project_id) > public.role_rank(role)
  AND user_id <> auth.uid()
);

DROP POLICY IF EXISTS "members changed below own authority" ON public.project_members;
CREATE POLICY "members changed below own authority"
ON public.project_members FOR UPDATE TO authenticated
USING (
  public.project_authority(auth.uid(), project_id) >= 50
  AND public.project_authority(auth.uid(), project_id) > public.role_rank(role)
  AND NOT public.is_owner(user_id)
  AND user_id <> auth.uid()
)
WITH CHECK (
  public.project_authority(auth.uid(), project_id) > public.role_rank(role)
  AND user_id <> auth.uid()
);

DROP POLICY IF EXISTS "members removed below own authority" ON public.project_members;
CREATE POLICY "members removed below own authority"
ON public.project_members FOR DELETE TO authenticated
USING (
  public.project_authority(auth.uid(), project_id) >= 50
  AND public.project_authority(auth.uid(), project_id) > public.role_rank(role)
  AND NOT public.is_owner(user_id)
  AND user_id <> auth.uid()
);

-- 4) Approved work is locked in the database, not just the interface ----------
DROP POLICY IF EXISTS "features update own or reviewer" ON public.features;
CREATE POLICY "features update own or reviewer"
ON public.features FOR UPDATE TO authenticated
USING (
  (
    created_by = auth.uid()
    AND public.can_digitize_in(auth.uid(), project_id, work_area_id)
    AND status <> 'verified'::review_status
  )
  OR public.can_review_project(auth.uid(), project_id)
)
WITH CHECK (
  public.can_review_project(auth.uid(), project_id)
  OR (
    created_by = auth.uid()
    AND public.can_digitize_in(auth.uid(), project_id, work_area_id)
    AND status IN ('draft'::review_status, 'submitted'::review_status, 'needs_revision'::review_status)
  )
);

DROP POLICY IF EXISTS "features delete own or manager" ON public.features;
CREATE POLICY "features delete own or manager"
ON public.features FOR DELETE TO authenticated
USING (
  (created_by = auth.uid() AND status = 'draft'::review_status)
  OR public.can_manage_project(auth.uid(), project_id)
);

-- 5) Trustworthy audit trail --------------------------------------------------
ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'client';

-- Client-written rows can never claim to be system-generated or impersonate.
CREATE OR REPLACE FUNCTION public.stamp_activity_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
    NEW.source := 'client';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activity_log_stamp_source ON public.activity_log;
CREATE TRIGGER activity_log_stamp_source
BEFORE INSERT ON public.activity_log
FOR EACH ROW EXECUTE FUNCTION public.stamp_activity_source();

-- System-generated audit rows for security-sensitive events.
CREATE OR REPLACE FUNCTION public.audit_feature_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_detail text;
  v_row public.features;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW; v_action := 'feature.created';
    v_detail := 'status ' || NEW.status;
  ELSIF TG_OP = 'DELETE' THEN
    v_row := OLD; v_action := 'feature.deleted';
    v_detail := 'status ' || OLD.status;
  ELSE
    v_row := NEW;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'feature.status_changed';
      v_detail := OLD.status || ' -> ' || NEW.status;
    ELSE
      v_action := 'feature.edited';
      v_detail := 'geometry or attributes updated';
    END IF;
  END IF;

  INSERT INTO public.activity_log (project_id, user_id, feature_id, action, detail, source)
  VALUES (v_row.project_id, auth.uid(), v_row.id, v_action, v_detail, 'system');

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS features_audit ON public.features;
CREATE TRIGGER features_audit
AFTER INSERT OR UPDATE OR DELETE ON public.features
FOR EACH ROW EXECUTE FUNCTION public.audit_feature_event();

CREATE OR REPLACE FUNCTION public.audit_membership_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
  v_action text;
  v_detail text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_project := NEW.project_id; v_action := 'member.added';
    v_detail := NEW.user_id::text || ' as ' || NEW.role;
  ELSIF TG_OP = 'DELETE' THEN
    v_project := OLD.project_id; v_action := 'member.removed';
    v_detail := OLD.user_id::text || ' was ' || OLD.role;
  ELSE
    v_project := NEW.project_id; v_action := 'member.role_changed';
    v_detail := NEW.user_id::text || ': ' || OLD.role || ' -> ' || NEW.role;
  END IF;

  INSERT INTO public.activity_log (project_id, user_id, action, detail, source)
  VALUES (v_project, auth.uid(), v_action, v_detail, 'system');

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_members_audit ON public.project_members;
CREATE TRIGGER project_members_audit
AFTER INSERT OR UPDATE OR DELETE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION public.audit_membership_event();

CREATE OR REPLACE FUNCTION public.audit_assignment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_area public.work_areas;
  v_action text;
  v_detail text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_area FROM public.work_areas WHERE id = NEW.work_area_id;
    v_action := 'assignment.added'; v_detail := NEW.user_id::text || ' -> ' || COALESCE(v_area.name, '?');
  ELSE
    SELECT * INTO v_area FROM public.work_areas WHERE id = OLD.work_area_id;
    v_action := 'assignment.removed'; v_detail := OLD.user_id::text || ' from ' || COALESCE(v_area.name, '?');
  END IF;

  INSERT INTO public.activity_log (project_id, user_id, action, detail, source)
  VALUES (v_area.project_id, auth.uid(), v_action, v_detail, 'system');

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_assignments_audit ON public.area_assignments;
CREATE TRIGGER area_assignments_audit
AFTER INSERT OR DELETE ON public.area_assignments
FOR EACH ROW EXECUTE FUNCTION public.audit_assignment_event();

-- 6) Read performance ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS features_project_created_idx
  ON public.features (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS features_project_status_idx
  ON public.features (project_id, status);
CREATE INDEX IF NOT EXISTS features_work_area_idx
  ON public.features (work_area_id);
CREATE INDEX IF NOT EXISTS activity_log_project_created_idx
  ON public.activity_log (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_members_user_idx
  ON public.project_members (user_id);

-- 7) Linter hygiene: pin search_path, drop anon execute on internal helpers ---
CREATE OR REPLACE FUNCTION public.role_rank(_role project_role)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _role
    WHEN 'manager' THEN 50
    WHEN 'supervisor' THEN 30
    WHEN 'contributor' THEN 10
    ELSE 0 END
$$;

REVOKE EXECUTE ON FUNCTION public.app_rank(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_digitize_in(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_review_project(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_app_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_assigned_to_area(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_authority(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_role_of(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.role_rank(project_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.shares_project(uuid, uuid) FROM anon;
