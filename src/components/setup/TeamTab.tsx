import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess, useProjectAreas } from "@/hooks/useProjectRole";
import { listAssignableAccounts } from "@/lib/directory.functions";
import {
  PROJECT_ROLES,
  ROLE_RANK,
  addMember,
  assignArea,
  fetchAssignments,
  fetchMembers,
  pk,
  removeMember,
  unassignArea,
  roleLabel,
  type ProjectRole,
} from "@/lib/projects";

/** Team list, role assignment, and which work area each contributor owns. */
export function TeamTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { authority, assignableRoles } = useProjectAccess(projectId);
  const queryClient = useQueryClient();

  // Profiles are no longer readable across the whole organisation, so the
  // candidate list comes from a server function that checks project authority.
  const directory = useServerFn(listAssignableAccounts);
  const profilesQuery = useQuery({
    queryKey: ["assignable-accounts", projectId],
    queryFn: () => directory({ data: { projectId } }),
    enabled: authority >= 50,
  });
  const membersQuery = useQuery({
    queryKey: pk.members(projectId),
    queryFn: () => fetchMembers(projectId),
  });
  const assignmentsQuery = useQuery({
    queryKey: pk.assignments(projectId),
    queryFn: () => fetchAssignments(projectId),
  });
  const areasQuery = useProjectAreas(projectId);

  const profiles = profilesQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const areas = areasQuery.data ?? [];

  const [pick, setPick] = useState<{ userId: string; role: ProjectRole }>({
    userId: "",
    role: "contributor",
  });
  const rolesYouCanGrant = PROJECT_ROLES.filter((role) => assignableRoles.includes(role.value));
  /** You may only change a role that sits below your own authority. */
  const canChange = (role: ProjectRole) =>
    rolesYouCanGrant.length > 0 && authority > ROLE_RANK[role];

  const name = (id: string | null) => {
    const profile = profiles.find((item) => item.id === id);
    return profile?.display_name ?? profile?.username ?? "Unknown";
  };

  const refreshTeam = () => {
    void queryClient.invalidateQueries({ queryKey: pk.members(projectId) });
    void queryClient.invalidateQueries({ queryKey: pk.assignments(projectId) });
    void queryClient.invalidateQueries({ queryKey: pk.areas(projectId) });
  };

  const add = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first");
      if (!pick.userId) throw new Error("Choose someone to add");
      await addMember({
        projectId,
        userId: pick.userId,
        role: pick.role,
        addedBy: user.id,
      });
    },
    onSuccess: () => {
      setPick({ userId: "", role: "contributor" });
      refreshTeam();
      toast.success("Added to the project");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not add that person"),
  });

  const assign = async (areaId: string, userId: string) => {
    if (!user) return;
    try {
      await assignArea({ workAreaId: areaId, userId, assignedBy: user.id });
      refreshTeam();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign that area");
    }
  };

  /**
   * Changing someone's project role. The database refuses a role at or above
   * your own authority, so the refusal is surfaced rather than swallowed.
   */
  const changeRole = async (userId: string, role: ProjectRole) => {
    if (!user) return;
    try {
      await addMember({ projectId, userId, role, addedBy: user.id });
      refreshTeam();
      toast.success(`Role changed to ${roleLabel(role)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That role change was refused");
    }
  };

  const notMembers = profiles.filter((profile) => !members.some((m) => m.user_id === profile.id));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Team &amp; assignments</h2>
        <p className="text-sm text-muted-foreground">
          Supervisors review work; contributors digitize only inside the areas you give them. You
          can only add or remove people at a level below your own.
        </p>
      </div>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">Add someone</CardTitle>
          <CardDescription>
            People appear here once they have created an account and signed in at least once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1 space-y-1.5">
            <Label>Person</Label>
            <Select
              value={pick.userId}
              onValueChange={(value) => setPick((current) => ({ ...current, userId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {notMembers.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.display_name ?? profile.username ?? profile.id}
                  </SelectItem>
                ))}
                {notMembers.length === 0 && (
                  <SelectItem value="none" disabled>
                    Everyone with an account is already on this project
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44 space-y-1.5">
            <Label>Role</Label>
            <Select
              value={pick.role}
              onValueChange={(value) =>
                setPick((current) => ({ ...current, role: value as ProjectRole }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rolesYouCanGrant.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            <UserPlus className="mr-1.5 size-4" /> Add to project
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((member) => {
            const mine = assignments.filter((row) => row.user_id === member.user_id);
            const free = areas.filter((area) => !mine.some((row) => row.work_area_id === area.id));
            return (
              <div key={member.id} className="rounded border border-border bg-card/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{name(member.user_id)}</p>
                  {canChange(member.role) ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) =>
                        void changeRole(member.user_id, value as ProjectRole)
                      }
                    >
                      <SelectTrigger className="h-7 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rolesYouCanGrant.map((role) => (
                          <SelectItem key={role.value} value={role.value}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {roleLabel(member.role)}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 text-xs text-destructive"
                    disabled={authority <= ROLE_RANK[member.role]}
                    onClick={async () => {
                      try {
                        await removeMember(member.id);
                        refreshTeam();
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Could not remove that person",
                        );
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>

                {member.role === "contributor" && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {mine.map((row) => {
                        const area = areas.find((item) => item.id === row.work_area_id);
                        return (
                          <Badge key={row.id} variant="secondary" className="gap-1 text-[10px]">
                            {area?.name ?? "Area"}
                            <button
                              type="button"
                              aria-label="Remove assignment"
                              onClick={async () => {
                                try {
                                  await unassignArea(row.id);
                                  refreshTeam();
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error ? error.message : "Could not unassign",
                                  );
                                }
                              }}
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        );
                      })}
                      {mine.length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          No work area yet — this person cannot digitize.
                        </span>
                      )}
                    </div>
                    <Select value="" onValueChange={(value) => void assign(value, member.user_id)}>
                      <SelectTrigger className="h-8 w-64 text-xs">
                        <SelectValue placeholder="Assign a work area" />
                      </SelectTrigger>
                      <SelectContent>
                        {free.map((area) => (
                          <SelectItem key={area.id} value={area.id}>
                            {area.name}
                          </SelectItem>
                        ))}
                        {free.length === 0 && (
                          <SelectItem value="none" disabled>
                            No unassigned areas left
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            );
          })}
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody on this project yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
