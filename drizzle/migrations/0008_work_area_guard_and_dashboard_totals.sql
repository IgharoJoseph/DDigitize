-- 1) Contributors may only move an assigned area's status ---------------------
-- RLS cannot restrict columns, so the definition is protected by a trigger.
-- Managers, supervisors and app admins (can_review_project) are unaffected.
CREATE OR REPLACE FUNCTION public.guard_work_area_definition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role / server-side maintenance has no auth.uid(): leave it alone.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.can_review_project(auth.uid(), OLD.project_id) THEN RETURN NEW; END IF;

  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.boundary IS DISTINCT FROM OLD.boundary
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Only a supervisor, manager or administrator can change a work area definition'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_areas_guard_definition ON public.work_areas;
CREATE TRIGGER work_areas_guard_definition
BEFORE UPDATE ON public.work_areas
FOR EACH ROW EXECUTE FUNCTION public.guard_work_area_definition();

REVOKE EXECUTE ON FUNCTION public.guard_work_area_definition() FROM PUBLIC, anon, authenticated;

-- 2) Dashboard totals computed in the database --------------------------------
-- SECURITY INVOKER: RLS still decides which rows each caller can count.
CREATE OR REPLACE FUNCTION public.dashboard_feature_counts(_as_contributor boolean DEFAULT false)
RETURNS TABLE (
  project_id uuid,
  total bigint,
  drafts bigint,
  submitted bigint,
  under_review bigint,
  approved bigint,
  corrections bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT f.project_id,
         count(*),
         count(*) FILTER (WHERE f.status = 'draft'),
         count(*) FILTER (WHERE f.status = 'submitted'),
         count(*) FILTER (WHERE f.status = 'under_review'),
         count(*) FILTER (WHERE f.status = 'verified'),
         count(*) FILTER (WHERE f.status = 'needs_revision')
  FROM public.features f
  WHERE f.project_id IS NOT NULL
    AND (
      (NOT _as_contributor AND public.can_review_project(auth.uid(), f.project_id))
      OR f.created_by = auth.uid()
    )
  GROUP BY f.project_id
$$;

CREATE OR REPLACE FUNCTION public.dashboard_area_counts()
RETURNS TABLE (
  project_id uuid,
  total bigint,
  not_started bigint,
  in_progress bigint,
  submitted bigint,
  complete bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.project_id,
         count(*),
         count(*) FILTER (WHERE a.status IN ('unassigned', 'assigned')),
         count(*) FILTER (WHERE a.status = 'in_progress'),
         count(*) FILTER (WHERE a.status = 'submitted'),
         count(*) FILTER (WHERE a.status = 'complete')
  FROM public.work_areas a
  GROUP BY a.project_id
$$;

CREATE OR REPLACE FUNCTION public.dashboard_contributor_count()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(DISTINCT m.user_id)::int
  FROM public.project_members m
  WHERE m.role = 'contributor'
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_feature_counts(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_area_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_contributor_count() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.dashboard_feature_counts(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_area_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_contributor_count() FROM PUBLIC, anon;
