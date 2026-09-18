import { useQuery } from "@tanstack/react-query";

import {
  fetchAssignments,
  fetchMembers,
  fetchProject,
  fetchWorkAreas,
  pk,
  type EffectiveRole,
} from "@/lib/projects";
import { useAuth } from "@/hooks/useAuth";
import { useRoleSimulation } from "@/hooks/useRoleSimulation";

export type ProjectAccess = {
  loading: boolean
  role: EffectiveRole
  canManage: boolean
  canReview: boolean
  canExport: boolean
  canSeeTeamProgress: boolean
  assignedAreaIds: string[]
  restrictedToAssignments: boolean
  isMember: boolean
};

export function useProjectAccess(projectId: string): ProjectAccess {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { activeRole, isSimulating } = useRoleSimulation();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(user && projectId),
  });
  const membersQuery = useQuery({
    queryKey: pk.members(projectId),
    queryFn: () => fetchMembers(projectId),
    enabled: Boolean(user && projectId),
  });
  const assignmentsQuery = useQuery({
    queryKey: pk.assignments(projectId),
    queryFn: () => fetchAssignments(projectId),
    enabled: Boolean(user && projectId),
  });

  const membership = membersQuery.data?.find((row) => row.user_id === user?.id) ?? null;
  const actualRole: EffectiveRole = isAdmin ? "admin" : (membership?.role ?? "none");

  // Role simulation is an administrator UX preview only. It never changes the
  // authenticated role or database permissions.
  const role: EffectiveRole = isAdmin && isSimulating ? (activeRole as EffectiveRole) : actualRole;
  const isOwner = projectQuery.data?.created_by === user?.id;

  const canManage =
    role === "admin" ||
    role === "manager" ||
    (role === "project_owner" && Boolean(isOwner));
  const canReview = canManage || role === "supervisor";
  const assignedAreaIds = (assignmentsQuery.data ?? [])
    .filter((row) => row.user_id === user?.id)
    .map((row) => row.work_area_id);

  const simulatedMembership = isSimulating && isAdmin;
  const isMember = simulatedMembership
    ? role === "project_owner"
      ? Boolean(isOwner)
      : role === "admin" || Boolean(membership)
    : actualRole !== "none";

  return {
    loading:
      authLoading || projectQuery.isLoading || membersQuery.isLoading || assignmentsQuery.isLoading,
    role,
    canManage,
    canReview,
    canExport: role === "admin",
    canSeeTeamProgress: canReview,
    assignedAreaIds,
    restrictedToAssignments: role === "contributor",
    isMember,
  };
}

export function useProjectAreas(projectId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: pk.areas(projectId),
    queryFn: () => fetchWorkAreas(projectId),
    enabled: Boolean(user && projectId),
  });
}
