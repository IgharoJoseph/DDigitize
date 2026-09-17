-- Richer project record, per-layer QA rules, and feature comments.

ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.project_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TYPE public.review_status ADD VALUE IF NOT EXISTS 'under_review';

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS client_ref TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS crs TEXT NOT NULL DEFAULT 'EPSG:4326';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS boundary JSONB;

-- Per-layer production rules used by live validation while digitising.
ALTER TABLE public.feature_categories
  ADD COLUMN IF NOT EXISTS check_duplicates BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.feature_categories
  ADD COLUMN IF NOT EXISTS allow_overlap BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.feature_categories
  ADD COLUMN IF NOT EXISTS overlap_severity TEXT NOT NULL DEFAULT 'warning';
ALTER TABLE public.feature_categories
  ADD COLUMN IF NOT EXISTS require_within_area BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.feature_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.feature_comments TO authenticated;
GRANT ALL ON public.feature_comments TO service_role;

ALTER TABLE public.feature_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments readable by project members"
  ON public.feature_comments FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "comments insert by project members"
  ON public.feature_comments FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id) AND auth.uid() = author_id);

CREATE POLICY "comments resolve by author or reviewer"
  ON public.feature_comments FOR UPDATE TO authenticated
  USING (auth.uid() = author_id OR public.can_review_project(auth.uid(), project_id));

CREATE INDEX IF NOT EXISTS feature_comments_feature_idx
  ON public.feature_comments (feature_id);
