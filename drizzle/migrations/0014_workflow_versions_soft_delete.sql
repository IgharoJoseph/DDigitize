-- Production workflow: version history, workflow transitions, soft deletion.
-- Additive: no table, column or data removed. Two policies are replaced (feature
-- deletion, so work always leaves a record) and one new guard trigger is added
-- alongside the existing guard_feature_fields trigger.

/* ------------------------- 1. soft deletion columns ------------------------ */
ALTER TABLE public.features
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

CREATE INDEX IF NOT EXISTS features_project_live_idx
  ON public.features (project_id, created_at DESC)
  WHERE deleted_at IS NULL;

/* --------------------------- 2. feature_versions -------------------------- */
CREATE TABLE IF NOT EXISTS public.feature_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  change_kind text NOT NULL,
  status public.review_status NOT NULL,
  category_id uuid,
  work_area_id uuid,
  geometry jsonb NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  area_sqm numeric NOT NULL DEFAULT 0,
  length_m numeric NOT NULL DEFAULT 0,
  review_note text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_versions TO authenticated;
GRANT ALL ON public.feature_versions TO service_role;

ALTER TABLE public.feature_versions ENABLE ROW LEVEL SECURITY;

-- History is readable by project members and written only by the trigger below,
-- so nobody can forge or rewrite a version entry.
DROP POLICY IF EXISTS "feature versions readable by members" ON public.feature_versions;
CREATE POLICY "feature versions readable by members"
  ON public.feature_versions FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE INDEX IF NOT EXISTS feature_versions_feature_idx
  ON public.feature_versions (feature_id, version DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS feature_versions_project_idx
  ON public.feature_versions (project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_feature_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_kind := 'created';
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_kind := 'deleted';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    v_kind := 'restored';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_kind := 'status:' || OLD.status || '->' || NEW.status;
  ELSIF NEW.geometry IS DISTINCT FROM OLD.geometry THEN
    v_kind := 'geometry';
  ELSIF NEW.attributes IS DISTINCT FROM OLD.attributes THEN
    v_kind := 'attributes';
  ELSE
    -- Housekeeping updates (bounding box, review stamps) are not versions.
    RETURN NEW;
  END IF;

  INSERT INTO public.feature_versions (
    feature_id, project_id, version, change_kind, status, category_id, work_area_id,
    geometry, attributes, area_sqm, length_m, review_note, changed_by
  ) VALUES (
    NEW.id, NEW.project_id, COALESCE(NEW.version, 1), v_kind, NEW.status,
    NEW.category_id, NEW.work_area_id, NEW.geometry, NEW.attributes,
    NEW.area_sqm, NEW.length_m, NEW.review_note, COALESCE(auth.uid(), NEW.updated_by, NEW.created_by)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS features_record_version ON public.features;
CREATE TRIGGER features_record_version
AFTER INSERT OR UPDATE ON public.features
FOR EACH ROW EXECUTE FUNCTION public.record_feature_version();

-- Seed history so existing features have a first version to compare against.
INSERT INTO public.feature_versions (
  feature_id, project_id, version, change_kind, status, category_id, work_area_id,
  geometry, attributes, area_sqm, length_m, review_note, changed_by, created_at
)
SELECT f.id, f.project_id, COALESCE(f.version, 1), 'baseline', f.status, f.category_id,
       f.work_area_id, f.geometry, f.attributes, f.area_sqm, f.length_m, f.review_note,
       f.created_by, f.created_at
FROM public.features f
WHERE f.project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.feature_versions v WHERE v.feature_id = f.id);

/* --------------- 3. workflow transitions and soft-delete guard ------------- */
CREATE OR REPLACE FUNCTION public.guard_feature_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  can_manage boolean;
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;

  can_manage := public.has_project_permission(uid, NEW.project_id, 'manage');

  /* -- soft deletion -- */
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    IF OLD.deleted_at IS NULL THEN
      -- removing work
      IF OLD.status = 'verified'
         AND NOT public.has_project_permission(uid, NEW.project_id, 'reopen') THEN
        RAISE EXCEPTION 'Approved work can only be removed by a reviewer'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF COALESCE(btrim(NEW.deletion_reason), '') = '' THEN
        RAISE EXCEPTION 'A reason is required when removing work'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.deleted_at := now();
      NEW.deleted_by := uid;
    ELSE
      -- restoring work
      IF NOT can_manage THEN
        RAISE EXCEPTION 'Only a project manager can restore removed work'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL AND NOT can_manage THEN
    RAISE EXCEPTION 'Removed work cannot be edited'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  /* -- workflow order -- */
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'          AND NEW.status IN ('submitted'))
      OR (OLD.status = 'submitted'     AND NEW.status IN ('under_review', 'needs_revision', 'draft'))
      OR (OLD.status = 'under_review'  AND NEW.status IN ('verified', 'needs_revision', 'submitted'))
      OR (OLD.status = 'needs_revision' AND NEW.status IN ('draft', 'submitted'))
      OR (OLD.status = 'verified'      AND NEW.status IN ('under_review', 'draft'))
    ) THEN
      RAISE EXCEPTION 'Work cannot move from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'needs_revision' AND COALESCE(btrim(NEW.review_note), '') = '' THEN
      RAISE EXCEPTION 'Leave a note describing the changes required'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS features_guard_workflow ON public.features;
CREATE TRIGGER features_guard_workflow
BEFORE UPDATE ON public.features
FOR EACH ROW EXECUTE FUNCTION public.guard_feature_workflow();

/* ----------------- 4. deletion leaves an organisational record ------------- */
-- Contributors no longer erase rows outright; they mark work as removed, which
-- keeps the feature, its history and its audit trail. Permanent removal stays
-- with project managers.
DROP POLICY IF EXISTS "features delete own or manager" ON public.features;
CREATE POLICY "features permanently deleted by manager"
  ON public.features FOR DELETE TO authenticated
  USING (public.can_manage_project(auth.uid(), project_id));

/* -------------------- 5. audit wording for the timeline -------------------- */
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
    v_row := OLD; v_action := 'feature.purged';
    v_detail := 'permanently removed (was ' || OLD.status || ')';
  ELSE
    v_row := NEW;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_action := 'feature.deleted';
      v_detail := COALESCE(NEW.deletion_reason, 'removed');
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_action := 'feature.restored';
      v_detail := 'restored from removed work';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'feature.status_changed';
      v_detail := OLD.status || ' -> ' || NEW.status;
    ELSIF NEW.geometry IS DISTINCT FROM OLD.geometry
       OR NEW.attributes IS DISTINCT FROM OLD.attributes THEN
      v_action := 'feature.edited';
      v_detail := 'geometry or attributes updated';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.activity_log (project_id, user_id, feature_id, action, detail, source)
  VALUES (v_row.project_id, auth.uid(), v_row.id, v_action, v_detail, 'system');

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
