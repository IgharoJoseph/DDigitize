import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import type { EffectiveRole, ProjectRole } from "@/lib/projects";
import { ROLE_RANK } from "@/lib/projects";
import { fetchAssignments, fetchMembers, fetchProject, fetchWorkAreas, pk } from "@/lib/projects";

export type ProjectAccess = {
  loading: boolean;
  role: EffectiveRole;
  /** Manager or app admin: may change layers, imagery, areas and the team. */
  canManage: boolean;
  /** Manager, supervisor or app admin: may verify or send work back. */
  canReview: boolean;
  /** Authority on the shared scale: owner 100, admin 90, manager 50, supervisor 30, contributor 10. */
  authority: number;
  /** Project roles this person may grant or remove: strictly below their own. */
  assignableRoles: ProjectRole[];
  /** Only app admins may download data. */
  canExport: boolean;
  /** Team-wide progress is for managers, supervisors and admins. */
  canSeeTeamProgress: boolean;
  /** Work areas this person is assigned to (empty for managers/admins = whole project). */
  assignedAreaIds: string[];
  /** True when digitizing is limited to the assigned areas. */
  restrictedToAssignments: boolean;
  isMember: boolean;
};

export function useProjectAccess(projectId: string): ProjectAccess {
  const { user, isAdmin, authority: appAuthority, loading: authLoading } = useAuth();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(user),
  });
  const membersQuery = useQuery({
    queryKey: pk.members(projectId),
    queryFn: () => fetchMembers(projectId),
    enabled: Boolean(user),
  });
  const assignmentsQuery = useQuery({
    queryKey: pk.assignments(projectId),
    queryFn: () => fetchAssignments(projectId),
    enabled: Boolean(user),
  });

  const membership = membersQuery.data?.find((row) => row.user_id === user?.id) ?? null;
  const role: EffectiveRole = isAdmin ? "admin" : (membership?.role ?? "none");

  const authority = Math.max(appAuthority, membership ? ROLE_RANK[membership.role] : 0);
  const assignableRoles = (["manager", "supervisor", "contributor"] as ProjectRole[]).filter(
    (candidate) => authority > ROLE_RANK[candidate],
  );
  const canManage = role === "admin" || role === "manager";
  const canReview = canManage || role === "supervisor";
  const assignedAreaIds = (assignmentsQuery.data ?? [])
    .filter((row) => row.user_id === user?.id)
    .map((row) => row.work_area_id);

  return {
    loading:
      authLoading || projectQuery.isLoading || membersQuery.isLoading || assignmentsQuery.isLoading,
    role,
    authority,
    assignableRoles,
    canManage,
    canReview,
    canExport: isAdmin,
    canSeeTeamProgress: canReview,
    assignedAreaIds,
    restrictedToAssignments: role === "contributor",
    isMember: role !== "none",
  };
}

export function useProjectAreas(projectId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: pk.areas(projectId),
    queryFn: () => fetchWorkAreas(projectId),
    enabled: Boolean(user),
  });
}
