-- Assigned contributors may move their own work area along (e.g. submit for QA).
CREATE POLICY "areas updated by assigned contributor"
  ON public.work_areas FOR UPDATE TO authenticated
  USING (public.is_assigned_to_area(auth.uid(), id));
