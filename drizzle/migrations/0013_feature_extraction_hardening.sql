-- Phase: feature extraction system. Additive only.

/* ----------------------- layer (category) configuration ---------------------- */
ALTER TABLE public.feature_categories
  ADD COLUMN IF NOT EXISTS max_vertices integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS max_payload_kb integer NOT NULL DEFAULT 512,
  ADD COLUMN IF NOT EXISTS require_within_project boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS forbid_self_intersection boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS editable_by_peers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visible_to_contributors boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_config jsonb NOT NULL DEFAULT '{}'::jsonb;

/* --------------------------- attribute configuration ------------------------- */
ALTER TABLE public.category_fields
  ADD COLUMN IF NOT EXISTS default_value text,
  ADD COLUMN IF NOT EXISTS min_value numeric,
  ADD COLUMN IF NOT EXISTS max_value numeric,
  ADD COLUMN IF NOT EXISTS max_length integer,
  ADD COLUMN IF NOT EXISTS pattern text,
  ADD COLUMN IF NOT EXISTS help_text text;

/* ------------------------------ feature lineage ------------------------------ */
ALTER TABLE public.features
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS bbox_min_lng double precision,
  ADD COLUMN IF NOT EXISTS bbox_min_lat double precision,
  ADD COLUMN IF NOT EXISTS bbox_max_lng double precision,
  ADD COLUMN IF NOT EXISTS bbox_max_lat double precision;

/* ----------------------------- geometry helpers ------------------------------ */
CREATE OR REPLACE FUNCTION public.geometry_vertex_count(_geom jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(count(*), 0)::integer FROM public.jsonb_coord_pairs(_geom)
$$;

CREATE OR REPLACE FUNCTION public.geometry_bbox(_geom jsonb)
RETURNS double precision[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[min(p[1]), min(p[2]), max(p[1]), max(p[2])]
  FROM public.jsonb_coord_pairs(_geom) AS p
$$;

/* Geometry kinds accepted for a layer's declared geometry type. */
CREATE OR REPLACE FUNCTION public.geometry_matches_type(_geom jsonb, _kind geom_type)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _kind
    WHEN 'polygon' THEN (_geom->>'type') IN ('Polygon', 'MultiPolygon')
    WHEN 'line'    THEN (_geom->>'type') IN ('LineString', 'MultiLineString')
    WHEN 'point'   THEN (_geom->>'type') IN ('Point', 'MultiPoint')
    ELSE false
  END
$$;

/*
  Server-side geometry + attribute validation for every insert and update.
  Runs before the existing work-area guard so the cheapest rejections happen
  first. Service-role/privileged sessions (auth.uid() IS NULL) keep their
  existing bypass for imports and maintenance, except for structural checks
  that would corrupt data (coordinates, CRS, empty geometry).
*/
CREATE OR REPLACE FUNCTION public.validate_feature_payload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cat public.feature_categories;
  fld public.category_fields;
  v_count integer;
  v_bbox double precision[];
  v_bytes integer;
  v_boundary jsonb;
  v_attr jsonb := COALESCE(NEW.attributes, '{}'::jsonb);
  v_value text;
  v_num numeric;
BEGIN
  IF NEW.geometry IS NULL OR jsonb_typeof(NEW.geometry) <> 'object'
     OR NEW.geometry->>'type' IS NULL THEN
    RAISE EXCEPTION 'The shape is missing its geometry' USING ERRCODE = 'check_violation';
  END IF;

  v_count := public.geometry_vertex_count(NEW.geometry);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'The shape is empty' USING ERRCODE = 'check_violation';
  END IF;

  v_bbox := public.geometry_bbox(NEW.geometry);
  IF v_bbox[1] < -180 OR v_bbox[3] > 180 OR v_bbox[2] < -90 OR v_bbox[4] > 90 THEN
    RAISE EXCEPTION 'The shape has coordinates outside WGS84 longitude/latitude range'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.bbox_min_lng := v_bbox[1];
  NEW.bbox_min_lat := v_bbox[2];
  NEW.bbox_max_lng := v_bbox[3];
  NEW.bbox_max_lat := v_bbox[4];

  IF NEW.category_id IS NOT NULL THEN
    SELECT * INTO cat FROM public.feature_categories WHERE id = NEW.category_id;
  END IF;

  IF cat.id IS NOT NULL THEN
    IF cat.project_id IS NOT NULL AND NEW.project_id IS NOT NULL
       AND cat.project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'That layer belongs to another project' USING ERRCODE = 'check_violation';
    END IF;

    IF NOT public.geometry_matches_type(NEW.geometry, cat.geometry_type) THEN
      RAISE EXCEPTION 'A % layer cannot hold a % shape', cat.geometry_type, NEW.geometry->>'type'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_count > GREATEST(cat.max_vertices, 3) THEN
      RAISE EXCEPTION 'The shape has % points, more than the % allowed on this layer',
        v_count, cat.max_vertices USING ERRCODE = 'check_violation';
    END IF;

    v_bytes := octet_length(NEW.geometry::text);
    IF v_bytes > GREATEST(cat.max_payload_kb, 8) * 1024 THEN
      RAISE EXCEPTION 'The shape is too large to store (% KB)', (v_bytes / 1024)
        USING ERRCODE = 'check_violation';
    END IF;

    -- Exact duplicate geometry on the same layer.
    IF cat.check_duplicates AND EXISTS (
      SELECT 1 FROM public.features f
      WHERE f.category_id = NEW.category_id
        AND f.project_id IS NOT DISTINCT FROM NEW.project_id
        AND f.id <> NEW.id
        AND f.geometry = NEW.geometry
    ) THEN
      RAISE EXCEPTION 'An identical shape already exists on this layer'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Project boundary containment.
    IF cat.require_within_project AND NEW.project_id IS NOT NULL THEN
      SELECT boundary INTO v_boundary FROM public.projects WHERE id = NEW.project_id;
      IF v_boundary IS NOT NULL
         AND NOT public.geometry_within_boundary(NEW.geometry, v_boundary) THEN
        RAISE EXCEPTION 'The shape falls outside the project boundary'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Attribute domains; required fields are enforced once work leaves draft.
    FOR fld IN SELECT * FROM public.category_fields WHERE category_id = cat.id LOOP
      v_value := CASE
        WHEN v_attr ? fld.key AND jsonb_typeof(v_attr -> fld.key) <> 'null'
        THEN v_attr ->> fld.key ELSE NULL END;

      IF fld.required AND COALESCE(v_value, '') = ''
         AND NEW.status <> 'draft' THEN
        RAISE EXCEPTION '% is required before this feature can be submitted', fld.label
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_value IS NULL OR v_value = '' THEN CONTINUE; END IF;

      IF fld.field_type = 'select' AND array_length(fld.options, 1) IS NOT NULL
         AND NOT (v_value = ANY (fld.options)) THEN
        RAISE EXCEPTION '% must be one of: %', fld.label, array_to_string(fld.options, ', ')
          USING ERRCODE = 'check_violation';
      END IF;

      IF fld.field_type = 'number' THEN
        BEGIN
          v_num := v_value::numeric;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION '% must be a number', fld.label USING ERRCODE = 'check_violation';
        END;
        IF fld.min_value IS NOT NULL AND v_num < fld.min_value THEN
          RAISE EXCEPTION '% must be at least %', fld.label, fld.min_value
            USING ERRCODE = 'check_violation';
        END IF;
        IF fld.max_value IS NOT NULL AND v_num > fld.max_value THEN
          RAISE EXCEPTION '% must be at most %', fld.label, fld.max_value
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      IF fld.field_type = 'boolean' AND lower(v_value) NOT IN ('true', 'false') THEN
        RAISE EXCEPTION '% must be yes or no', fld.label USING ERRCODE = 'check_violation';
      END IF;

      IF fld.max_length IS NOT NULL AND char_length(v_value) > fld.max_length THEN
        RAISE EXCEPTION '% may hold at most % characters', fld.label, fld.max_length
          USING ERRCODE = 'check_violation';
      END IF;

      IF fld.pattern IS NOT NULL AND fld.pattern <> '' AND v_value !~ fld.pattern THEN
        RAISE EXCEPTION '% is not in the expected format', fld.label
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  -- Version + audit stamps are server-owned.
  IF TG_OP = 'INSERT' THEN
    NEW.version := 1;
    NEW.updated_by := uid;
  ELSE
    IF NEW.geometry IS DISTINCT FROM OLD.geometry
       OR NEW.attributes IS DISTINCT FROM OLD.attributes
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
      NEW.version := COALESCE(OLD.version, 1) + 1;
      NEW.updated_at := now();
      NEW.updated_by := COALESCE(uid, OLD.updated_by);
    ELSE
      NEW.version := COALESCE(OLD.version, 1);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS features_validate_payload ON public.features;
CREATE TRIGGER features_validate_payload
  BEFORE INSERT OR UPDATE ON public.features
  FOR EACH ROW EXECUTE FUNCTION public.validate_feature_payload();

/* Backfill bounding boxes for existing rows. */
UPDATE public.features f
SET bbox_min_lng = b[1], bbox_min_lat = b[2], bbox_max_lng = b[3], bbox_max_lat = b[4]
FROM (SELECT id, public.geometry_bbox(geometry) AS b FROM public.features) s(id, b)
WHERE f.id = s.id AND f.bbox_min_lng IS NULL AND s.b[1] IS NOT NULL;

/* ---------------------------- peer editing permission ------------------------ */
CREATE OR REPLACE FUNCTION public.can_edit_feature(
  _user_id uuid, _project_id uuid, _work_area_id uuid, _category_id uuid, _created_by uuid
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_review_project(_user_id, _project_id)
    OR (
      _created_by = _user_id
      AND public.can_digitize_in(_user_id, _project_id, _work_area_id)
    )
    OR (
      -- Explicitly authorised peer editing, configured per layer by a manager.
      _created_by <> _user_id
      AND public.can_digitize_in(_user_id, _project_id, _work_area_id)
      AND EXISTS (
        SELECT 1 FROM public.feature_categories c
        WHERE c.id = _category_id AND c.editable_by_peers
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_edit_feature(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_feature(uuid, uuid, uuid, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.geometry_vertex_count(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.geometry_bbox(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.geometry_matches_type(jsonb, geom_type) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.geometry_vertex_count(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geometry_bbox(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geometry_matches_type(jsonb, geom_type) TO authenticated, service_role;

DROP POLICY IF EXISTS "features update own or reviewer" ON public.features;
CREATE POLICY "features update own peer or reviewer"
  ON public.features FOR UPDATE TO authenticated
  USING (
    public.can_edit_feature(auth.uid(), project_id, work_area_id, category_id, created_by)
    AND (status <> 'verified' OR public.can_review_project(auth.uid(), project_id))
  )
  WITH CHECK (
    public.can_review_project(auth.uid(), project_id)
    OR (
      public.can_edit_feature(auth.uid(), project_id, work_area_id, category_id, created_by)
      AND status = ANY (ARRAY['draft'::review_status, 'submitted'::review_status, 'needs_revision'::review_status])
    )
  );

/* ------------------------------- query indexes ------------------------------- */
CREATE INDEX IF NOT EXISTS features_project_category_idx
  ON public.features (project_id, category_id);
CREATE INDEX IF NOT EXISTS features_project_status_idx
  ON public.features (project_id, status);
CREATE INDEX IF NOT EXISTS features_project_creator_idx
  ON public.features (project_id, created_by);
CREATE INDEX IF NOT EXISTS features_project_bbox_idx
  ON public.features (project_id, bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS category_fields_category_sort_idx
  ON public.category_fields (category_id, sort_order);