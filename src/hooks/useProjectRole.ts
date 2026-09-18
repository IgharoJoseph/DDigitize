import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { EffectiveRole, ProjectRole } from "@/lib/projects";
import { ROLE_RANK } from "@/lib/projects";
import { fetchAssignments, fetchMembers, fetchProject, fetchWorkAreas, pk } from "@/lib/projects";

/** The permissions the database can grant on a project. */
export type ProjectPermission =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "submit"
  | "review"
  | "approve"
  | "request_changes"
  | "reopen"
  | "export"
  | "manage"
  | "assign";

export type ProjectAccess = {
  loading: boolean;
  role: EffectiveRole;
  /** True when this account owns the project outright. */
  isProjectOwner: boolean;
  /** Permissions granted by the database for this project. */
  permissions: ProjectPermission[];
  /** Ask the database's permission matrix, mirrored here for the interface. */
  can: (permission: ProjectPermission) => boolean;
  /** May change layers, imagery, areas and the team. */
  canManage: boolean;
  /** May verify work or send it back. */
  canReview: boolean;
  /** Authority on the shared scale: owner 100, admin 90, project owner 80, org manager 60, project manager 50, supervisor 30, contributor 10. */
  authority: number;
  /** Project roles this person may grant or remove: strictly below their own. */
  assignableRoles: ProjectRole[];
  /** May download project data. */
  canExport: boolean;
  /** Team-wide progress is for reviewers and managers. */
  canSeeTeamProgress: boolean;
  /** Work areas this person is assigned to (empty for reviewers = whole project). */
  assignedAreaIds: string[];
  /** True when digitizing is limited to the assigned areas. */
  restrictedToAssignments: boolean;
  isMember: boolean;
};

const NO_PERMISSIONS: ProjectPermission[] = [];

export function useProjectAccess(projectId: string): ProjectAccess {
  const {
    user,
    isAdmin,
    isManager,
    authority: appAuthority,
    loading: authLoading,
    previewRole,
  } = useAuth();

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
  // The permission list comes from the same database function the row-level
  // policies use, so the interface can never offer more than the server allows.
  const permissionsQuery = useQuery({
    queryKey: ["project-permissions", projectId, user?.id],
    queryFn: async (): Promise<ProjectPermission[]> => {
      const { data, error } = await supabase.rpc("project_permissions", {
        _project_id: projectId,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ProjectPermission[];
    },
    enabled: Boolean(user),
  });

  const membership = membersQuery.data?.find((row) => row.user_id === user?.id) ?? null;
  const previewingContributor = previewRole === "contributor";
  const isProjectOwner =
    !previewingContributor && Boolean(user && projectQuery.data?.owner_id === user.id);

  const granted = permissionsQuery.data ?? NO_PERMISSIONS;
  const permissions = useMemo<ProjectPermission[]>(
    () =>
      previewingContributor
        ? granted.filter((permission) =>
            (["view", "create", "edit", "submit", "delete"] as ProjectPermission[]).includes(
              permission,
            ),
          )
        : granted,
    [granted, previewingContributor],
  );
  const can = (permission: ProjectPermission) => permissions.includes(permission);

  const role: EffectiveRole = previewingContributor
    ? "contributor"
    : isAdmin
      ? "system_admin"
      : isProjectOwner
        ? "owner"
        : (membership?.role ?? (isManager ? "org_manager" : "none"));

  const authority = previewingContributor
    ? ROLE_RANK.contributor
    : Math.max(appAuthority, isProjectOwner ? 80 : 0, membership ? ROLE_RANK[membership.role] : 0);
  const assignableRoles = (["manager", "supervisor", "contributor"] as ProjectRole[]).filter(
    (candidate) => authority > ROLE_RANK[candidate] && can("manage"),
  );
  const canManage = can("manage");
  const canReview = can("review");
  // Kept stable across renders: the map uses this list in effect dependencies,
  // and a fresh array each render made those effects loop.
  const assignmentRows = assignmentsQuery.data;
  const assignedAreaIds = useMemo(
    () =>
      (assignmentRows ?? [])
        .filter((row) => row.user_id === user?.id)
        .map((row) => row.work_area_id),
    [assignmentRows, user?.id],
  );

  return {
    loading:
      authLoading ||
      projectQuery.isLoading ||
      membersQuery.isLoading ||
      assignmentsQuery.isLoading ||
      permissionsQuery.isLoading,
    role,
    isProjectOwner,
    permissions,
    can,
    authority,
    assignableRoles,
    canManage,
    canReview,
    canExport: can("export"),
    canSeeTeamProgress: canReview,
    assignedAreaIds,
    restrictedToAssignments: !canReview,
    isMember: previewingContributor ? true : can("view"),
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
