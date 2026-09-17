-- 1. Enums
CREATE TYPE public.project_role AS ENUM ('manager', 'supervisor', 'contributor');
CREATE TYPE public.project_status AS ENUM ('setup', 'active', 'review', 'closed');
CREATE TYPE public.area_status AS ENUM ('unassigned', 'assigned', 'in_progress', 'submitted', 'complete');

-- 2. Projects
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status public.project_status NOT NULL DEFAULT 'setup',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.project_role NOT NULL DEFAULT 'contributor',
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.work_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  boundary jsonb NOT NULL,
  status public.area_status NOT NULL DEFAULT 'unassigned',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_areas TO authenticated;
GRANT ALL ON public.work_areas TO service_role;
ALTER TABLE public.work_areas ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.area_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_area_id uuid NOT NULL REFERENCES public.work_areas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_area_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.area_assignments TO authenticated;
GRANT ALL ON public.area_assignments TO service_role;
ALTER TABLE public.area_assignments ENABLE ROW LEVEL SECURITY;

-- 3. Project scoping on existing tables
ALTER TABLE public.feature_categories ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.imagery_datasets ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.features ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.features ADD COLUMN work_area_id uuid REFERENCES public.work_areas(id) ON DELETE SET NULL;
ALTER TABLE public.activity_log ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

-- 4. Helper functions (before policies)
CREATE OR REPLACE FUNCTION public.is_app_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION public.project_role_of(_user_id uuid, _project_id uuid)
RETURNS public.project_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id
$$;

CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_app_admin(_user_id)
     OR EXISTS (SELECT 1 FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id)
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_app_admin(_user_id)
     OR public.project_role_of(_user_id, _project_id) = 'manager'
$$;

CREATE OR REPLACE FUNCTION public.can_review_project(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_app_admin(_user_id)
     OR public.project_role_of(_user_id, _project_id) IN ('manager', 'supervisor')
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_to_area(_user_id uuid, _work_area_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.area_assignments
    WHERE user_id = _user_id AND work_area_id = _work_area_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_digitize_in(_user_id uuid, _project_id uuid, _work_area_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_review_project(_user_id, _project_id)
     OR (
       _work_area_id IS NOT NULL
       AND public.is_assigned_to_area(_user_id, _work_area_id)
       AND EXISTS (
         SELECT 1 FROM public.work_areas
         WHERE id = _work_area_id AND project_id = _project_id
       )
     )
$$;

-- 5. Policies on the new tables
CREATE POLICY "projects readable by members" ON public.projects
  FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), id));
CREATE POLICY "projects created by admin" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (public.is_app_admin(auth.uid()) AND created_by = auth.uid());
CREATE POLICY "projects updated by manager" ON public.projects
  FOR UPDATE TO authenticated USING (public.can_manage_project(auth.uid(), id));
CREATE POLICY "projects deleted by admin" ON public.projects
  FOR DELETE TO authenticated USING (public.is_app_admin(auth.uid()));

CREATE POLICY "members readable by members" ON public.project_members
  FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "members managed insert" ON public.project_members
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "members managed update" ON public.project_members
  FOR UPDATE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "members managed delete" ON public.project_members
  FOR DELETE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));

CREATE POLICY "areas readable by members" ON public.work_areas
  FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "areas managed insert" ON public.work_areas
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "areas managed update" ON public.work_areas
  FOR UPDATE TO authenticated USING (public.can_review_project(auth.uid(), project_id));
CREATE POLICY "areas managed delete" ON public.work_areas
  FOR DELETE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));

CREATE POLICY "assignments readable by members" ON public.area_assignments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.work_areas wa WHERE wa.id = work_area_id AND public.is_project_member(auth.uid(), wa.project_id))
  );
CREATE POLICY "assignments managed insert" ON public.area_assignments
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.work_areas wa WHERE wa.id = work_area_id AND public.can_manage_project(auth.uid(), wa.project_id))
  );
CREATE POLICY "assignments managed delete" ON public.area_assignments
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.work_areas wa WHERE wa.id = work_area_id AND public.can_manage_project(auth.uid(), wa.project_id))
  );

-- 6. Replace open policies on the existing tables with project-scoped ones
DROP POLICY IF EXISTS "categories readable" ON public.feature_categories;
DROP POLICY IF EXISTS "categories admin insert" ON public.feature_categories;
DROP POLICY IF EXISTS "categories admin update" ON public.feature_categories;
DROP POLICY IF EXISTS "categories admin delete" ON public.feature_categories;
CREATE POLICY "categories readable by members" ON public.feature_categories
  FOR SELECT TO authenticated USING (project_id IS NULL OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "categories manager insert" ON public.feature_categories
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "categories manager update" ON public.feature_categories
  FOR UPDATE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "categories manager delete" ON public.feature_categories
  FOR DELETE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "fields readable" ON public.category_fields;
DROP POLICY IF EXISTS "fields admin insert" ON public.category_fields;
DROP POLICY IF EXISTS "fields admin update" ON public.category_fields;
DROP POLICY IF EXISTS "fields admin delete" ON public.category_fields;
CREATE POLICY "fields readable by members" ON public.category_fields
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.feature_categories c WHERE c.id = category_id
            AND (c.project_id IS NULL OR public.is_project_member(auth.uid(), c.project_id)))
  );
CREATE POLICY "fields manager insert" ON public.category_fields
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.feature_categories c WHERE c.id = category_id AND public.can_manage_project(auth.uid(), c.project_id))
  );
CREATE POLICY "fields manager update" ON public.category_fields
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.feature_categories c WHERE c.id = category_id AND public.can_manage_project(auth.uid(), c.project_id))
  );
CREATE POLICY "fields manager delete" ON public.category_fields
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.feature_categories c WHERE c.id = category_id AND public.can_manage_project(auth.uid(), c.project_id))
  );

DROP POLICY IF EXISTS "imagery published readable" ON public.imagery_datasets;
DROP POLICY IF EXISTS "imagery admin write" ON public.imagery_datasets;
DROP POLICY IF EXISTS "imagery admin update" ON public.imagery_datasets;
DROP POLICY IF EXISTS "imagery admin delete" ON public.imagery_datasets;
CREATE POLICY "imagery readable by members" ON public.imagery_datasets
  FOR SELECT TO authenticated USING (project_id IS NULL OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "imagery manager insert" ON public.imagery_datasets
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "imagery manager update" ON public.imagery_datasets
  FOR UPDATE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));
CREATE POLICY "imagery manager delete" ON public.imagery_datasets
  FOR DELETE TO authenticated USING (public.can_manage_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "features readable" ON public.features;
DROP POLICY IF EXISTS "features insert own" ON public.features;
DROP POLICY IF EXISTS "features update own or admin" ON public.features;
DROP POLICY IF EXISTS "features delete own or admin" ON public.features;
CREATE POLICY "features readable by members" ON public.features
  FOR SELECT TO authenticated USING (project_id IS NULL OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "features insert in assigned area" ON public.features
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid() AND public.can_digitize_in(auth.uid(), project_id, work_area_id)
  );
CREATE POLICY "features update own or reviewer" ON public.features
  FOR UPDATE TO authenticated USING (
    (created_by = auth.uid() AND public.can_digitize_in(auth.uid(), project_id, work_area_id))
    OR public.can_review_project(auth.uid(), project_id)
  );
CREATE POLICY "features delete own or manager" ON public.features
  FOR DELETE TO authenticated USING (
    (created_by = auth.uid() AND status = 'draft') OR public.can_manage_project(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "activity readable" ON public.activity_log;
DROP POLICY IF EXISTS "activity insert own" ON public.activity_log;
CREATE POLICY "activity readable by members" ON public.activity_log
  FOR SELECT TO authenticated USING (project_id IS NULL OR public.is_project_member(auth.uid(), project_id));
CREATE POLICY "activity insert own" ON public.activity_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- profiles: keep readable to authenticated only
DROP POLICY IF EXISTS "profiles readable" ON public.profiles;
CREATE POLICY "profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);

REVOKE SELECT ON public.features FROM anon;
REVOKE SELECT ON public.feature_categories FROM anon;
REVOKE SELECT ON public.category_fields FROM anon;
REVOKE SELECT ON public.imagery_datasets FROM anon;
REVOKE SELECT ON public.activity_log FROM anon;
REVOKE SELECT ON public.profiles FROM anon;

-- 7. Sample project backfill so existing seeded rows keep working
INSERT INTO public.projects (id, name, description, status)
VALUES ('00000000-0000-4000-8000-000000000001', 'Sample project', 'Seeded demo categories and imagery.', 'active');

UPDATE public.feature_categories SET project_id = '00000000-0000-4000-8000-000000000001' WHERE project_id IS NULL;
UPDATE public.imagery_datasets SET project_id = '00000000-0000-4000-8000-000000000001' WHERE project_id IS NULL;
UPDATE public.features SET project_id = '00000000-0000-4000-8000-000000000001' WHERE project_id IS NULL;
UPDATE public.activity_log SET project_id = '00000000-0000-4000-8000-000000000001' WHERE project_id IS NULL;

CREATE INDEX idx_features_project ON public.features(project_id);
CREATE INDEX idx_features_area ON public.features(work_area_id);
CREATE INDEX idx_categories_project ON public.feature_categories(project_id);
CREATE INDEX idx_imagery_project ON public.imagery_datasets(project_id);
CREATE INDEX idx_members_user ON public.project_members(user_id);
CREATE INDEX idx_assignments_user ON public.area_assignments(user_id);
