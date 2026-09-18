-- Phase: project & work-area management.
-- Additive only: new enum values, a new history table, containment enforcement,
-- an updated_at stamp on work areas, and supporting indexes.

ALTER TYPE public.area_status ADD VALUE IF NOT EXISTS 'under_review';
ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'planning';

-- 1. Work areas gain an update stamp (existing rows fall back to created_at).
ALTER TABLE public.work_areas
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE public.work_areas SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE public.work_areas ALTER COLUMN updated_at SET DEFAULT now();

DROP TRIGGER IF EXISTS trg_work_areas_touch ON public.work_areas;
CREATE TRIGGER trg_work_areas_touch
  BEFORE UPDATE ON public.work_areas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Assignment history: every assign / unassign event is recorded server-side.
CREATE TABLE IF NOT EXISTS public.area_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_area_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.area_assignment_history TO authenticated;
GRANT ALL ON public.area_assignment_history TO service_role;
ALTER TABLE public.area_assignment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "history readable by project viewers" ON public.area_assignment_history;
CREATE POLICY "history readable by project viewers"
  ON public.area_assignment_history FOR SELECT TO authenticated
  USING (public.has_project_permission(auth.uid(), project_id, 'view'));

CREATE OR REPLACE FUNCTION public.record_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT project_id INTO v_project FROM public.work_areas WHERE id = NEW.work_area_id;
    INSERT INTO public.area_assignment_history (project_id, work_area_id, user_id, action, actor_id)
    VALUES (v_project, NEW.work_area_id, NEW.user_id, 'assigned', auth.uid());
    RETURN NEW;
  END IF;

  SELECT project_id INTO v_project FROM public.work_areas WHERE id = OLD.work_area_id;
  IF v_project IS NOT NULL THEN
    INSERT INTO public.area_assignment_history (project_id, work_area_id, user_id, action, actor_id)
    VALUES (v_project, OLD.work_area_id, OLD.user_id, 'unassigned', auth.uid());
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_assignment_history ON public.area_assignments;
CREATE TRIGGER trg_assignment_history
  AFTER INSERT OR DELETE ON public.area_assignments
  FOR EACH ROW EXECUTE FUNCTION public.record_assignment_history();

-- 3. Server-side spatial containment for contributors.
--    Geometry stays JSON (WGS84 [lng, lat]); the checks below are pure SQL so
--    the existing architecture is untouched.
CREATE OR REPLACE FUNCTION public.jsonb_coord_pairs(_geom jsonb)
RETURNS SETOF double precision[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH RECURSIVE walk(node) AS (
    SELECT _geom -> 'coordinates'
    UNION ALL
    SELECT e
    FROM walk, LATERAL jsonb_array_elements(walk.node) e
    WHERE jsonb_typeof(walk.node) = 'array'
      AND jsonb_typeof(walk.node -> 0) = 'array'
  )
  SELECT ARRAY[(node ->> 0)::double precision, (node ->> 1)::double precision]
  FROM walk
  WHERE jsonb_typeof(node) = 'array'
    AND jsonb_typeof(node -> 0) = 'number';
$$;

CREATE OR REPLACE FUNCTION public.point_in_ring(_lng double precision, _lat double precision, _ring jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n integer;
  i integer;
  x1 double precision; y1 double precision;
  x2 double precision; y2 double precision;
  inside boolean := false;
BEGIN
  IF _ring IS NULL OR jsonb_typeof(_ring) <> 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(_ring);
  IF n < 3 THEN RETURN false; END IF;

  FOR i IN 0 .. n - 1 LOOP
    x1 := (_ring -> i ->> 0)::double precision;
    y1 := (_ring -> i ->> 1)::double precision;
    x2 := (_ring -> ((i + 1) % n) ->> 0)::double precision;
    y2 := (_ring -> ((i + 1) % n) ->> 1)::double precision;
    IF ((y1 > _lat) <> (y2 > _lat))
       AND (_lng < (x2 - x1) * (_lat - y1) / NULLIF(y2 - y1, 0) + x1) THEN
      inside := NOT inside;
    END IF;
  END LOOP;

  RETURN inside;
END;
$$;

CREATE OR REPLACE FUNCTION public.geometry_within_boundary(_geom jsonb, _boundary jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  outer_ring jsonb;
  holes integer;
  h integer;
  pair double precision[];
  ok boolean;
BEGIN
  IF _geom IS NULL OR _boundary IS NULL THEN RETURN false; END IF;
  outer_ring := _boundary -> 'coordinates' -> 0;
  IF outer_ring IS NULL THEN RETURN false; END IF;
  holes := COALESCE(jsonb_array_length(_boundary -> 'coordinates'), 1) - 1;

  FOR pair IN SELECT * FROM public.jsonb_coord_pairs(_geom) LOOP
    IF pair[1] IS NULL OR pair[2] IS NULL THEN RETURN false; END IF;
    IF NOT public.point_in_ring(pair[1], pair[2], outer_ring) THEN
      RETURN false;
    END IF;
    FOR h IN 1 .. GREATEST(holes, 0) LOOP
      IF public.point_in_ring(pair[1], pair[2], _boundary -> 'coordinates' -> h) THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;

  -- An empty coordinate list is not inside anything.
  SELECT EXISTS (SELECT 1 FROM public.jsonb_coord_pairs(_geom)) INTO ok;
  RETURN COALESCE(ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_feature_within_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_boundary jsonb;
  v_required boolean;
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  -- Reviewers (supervisor, project manager, owner, manager, admin) work project-wide.
  IF public.has_project_permission(uid, NEW.project_id, 'review') THEN RETURN NEW; END IF;

  IF NEW.work_area_id IS NULL THEN
    RAISE EXCEPTION 'Outside assigned work area'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.is_assigned_to_area(uid, NEW.work_area_id) THEN
    RAISE EXCEPTION 'Outside assigned work area'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT boundary INTO v_boundary
  FROM public.work_areas
  WHERE id = NEW.work_area_id AND project_id = NEW.project_id;

  IF v_boundary IS NULL THEN
    RAISE EXCEPTION 'Outside assigned work area'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(require_within_area, true) INTO v_required
  FROM public.feature_categories WHERE id = NEW.category_id;

  IF COALESCE(v_required, true)
     AND NOT public.geometry_within_boundary(NEW.geometry, v_boundary) THEN
    RAISE EXCEPTION 'Outside assigned work area'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_within_area ON public.features;
CREATE TRIGGER trg_feature_within_area
  BEFORE INSERT OR UPDATE OF geometry, work_area_id, category_id ON public.features
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_within_area();

REVOKE EXECUTE ON FUNCTION public.jsonb_coord_pairs(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.point_in_ring(double precision, double precision, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.geometry_within_boundary(jsonb, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_assignment_history() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_feature_within_area() FROM anon;

-- 4. Indexes for the lookups this phase adds.
CREATE INDEX IF NOT EXISTS work_areas_project_idx ON public.work_areas (project_id);
CREATE INDEX IF NOT EXISTS work_areas_project_status_idx ON public.work_areas (project_id, status);
CREATE INDEX IF NOT EXISTS area_assignments_user_idx ON public.area_assignments (user_id);
CREATE INDEX IF NOT EXISTS features_project_area_idx ON public.features (project_id, work_area_id);
CREATE INDEX IF NOT EXISTS assignment_history_area_idx
  ON public.area_assignment_history (work_area_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignment_history_project_idx
  ON public.area_assignment_history (project_id, created_at DESC);
