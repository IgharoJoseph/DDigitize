-- Leaving a project must also drop the work-area assignments that belonged to
-- that membership, so no digitising scope survives a removal from the team.
CREATE OR REPLACE FUNCTION public.clear_assignments_on_member_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.area_assignments a
  USING public.work_areas w
  WHERE a.work_area_id = w.id
    AND w.project_id = OLD.project_id
    AND a.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_assignments_on_member_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS project_members_clear_assignments ON public.project_members;
CREATE TRIGGER project_members_clear_assignments AFTER DELETE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION public.clear_assignments_on_member_removal();