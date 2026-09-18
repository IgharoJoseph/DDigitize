-- Tighten EXECUTE on database helpers: the app only needs them as a signed-in
-- user, and trigger functions should not be callable through the API at all.

-- Helpers used by policies and by the signed-in app.
REVOKE EXECUTE ON FUNCTION public.app_rank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_rank(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_digitize_in(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_digitize_in(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_review_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_project(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_app_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_app_admin(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_assigned_to_area(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_to_area(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.project_authority(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_authority(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.project_role_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_role_of(uuid, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.role_rank(project_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.role_rank(project_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.shares_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_project(uuid, uuid) TO authenticated, service_role;

-- Trigger-only functions: not callable by API clients at all.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_activity_source() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_feature_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_membership_event() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_assignment_event() FROM PUBLIC, anon, authenticated;
