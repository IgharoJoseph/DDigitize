import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess } from "@/hooks/useProjectRole";
import { fetchFeatures, fetchProfiles, qk } from "@/lib/data";
import {
  AREA_STATUSES,
  assignArea,
  fetchAssignments,
  fetchMembers,
  fetchWorkAreas,
  pk,
  unassignArea,
  updateWorkArea,
  type AreaStatus,
} from "@/lib/projects";

export const Route = createFileRoute("/p/$projectId/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — DDigitize" },
      {
        name: "description",
        content:
          "Every work area as a task: who it belongs to, its production status, feature count and progress.",
      },
      { property: "og:title", content: "DDigitize tasks" },
      {
        property: "og:description",
        content: "Assign, reassign and track digitising tasks per work area.",
      },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  const { projectId } = Route.useParams();
  const { user } = useAuth();
  const access = useProjectAccess(projectId);
  const queryClient = useQueryClient();

  const areasQuery = useQuery({
    queryKey: pk.areas(projectId),
    queryFn: () => fetchWorkAreas(projectId),
    enabled: Boolean(user),
  });
  const assignmentsQuery = useQuery({
    queryKey: pk.assignments(projectId),
    queryFn: () => fetchAssignments(projectId),
    enabled: Boolean(user),
  });
  const membersQuery = useQuery({
    queryKey: pk.members(projectId),
    queryFn: () => fetchMembers(projectId),
    enabled: Boolean(user),
  });
  const featuresQuery = useQuery({
    queryKey: qk.features(projectId),
    queryFn: () => fetchFeatures(projectId),
    enabled: Boolean(user),
  });
  const profilesQuery = useQuery({ queryKey: qk.profiles, queryFn: fetchProfiles });

  const areas = areasQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const features = featuresQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];

  const nameOf = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    return profile?.display_name ?? profile?.email ?? id.slice(0, 8);
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: pk.areas(projectId) });
    void queryClient.invalidateQueries({ queryKey: pk.assignments(projectId) });
  };

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: AreaStatus }) =>
      updateWorkArea(input.id, { status: input.status }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update"),
  });

  const reassign = useMutation({
    mutationFn: async (input: { areaId: string; userId: string }) => {
      if (!user) throw new Error("Sign in first");
      // One contributor per task: clear existing holders first.
      for (const row of assignments.filter((a) => a.work_area_id === input.areaId)) {
        await unassignArea(row.id);
      }
      if (input.userId === "none") return;
      await assignArea({ workAreaId: input.areaId, userId: input.userId, assignedBy: user.id });
    },
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not assign"),
  });

  const contributors = members.filter((m) => m.role === "contributor");
  const visibleAreas = access.restrictedToAssignments
    ? areas.filter((area) => access.assignedAreaIds.includes(area.id))
    : areas;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {access.restrictedToAssignments
              ? "The work areas assigned to you."
              : "One task per work area. Assign a contributor and track its status."}
          </p>
        </div>

        <div className="space-y-2">
          {visibleAreas.map((area) => {
            const holders = assignments.filter((a) => a.work_area_id === area.id);
            const areaFeatures = features.filter((f) => f.work_area_id === area.id);
            const approved = areaFeatures.filter((f) => f.status === "verified").length;
            const percent =
              areaFeatures.length === 0 ? 0 : Math.round((approved / areaFeatures.length) * 100);
            return (
              <div key={area.id} className="rounded border border-border bg-panel p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{area.name}</span>
                  <Badge variant="outline" className="text-[9px] uppercase">
                    {area.status.replace("_", " ")}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {holders.length > 0
                      ? holders.map((h) => nameOf(h.user_id)).join(", ")
                      : "Unassigned"}
                  </span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {areaFeatures.length} features · {approved} approved
                  </span>
                </div>
                <Progress value={percent} className="mt-2 h-1.5" />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to="/p/$projectId" params={{ projectId }}>
                      Open on map
                    </Link>
                  </Button>
                  {access.canReview && (
                    <>
                      <Select
                        value={holders[0]?.user_id ?? "none"}
                        onValueChange={(value) =>
                          reassign.mutate({ areaId: area.id, userId: value })
                        }
                      >
                        <SelectTrigger className="h-7 w-44 text-xs">
                          <SelectValue placeholder="Assign contributor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {contributors.map((member) => (
                            <SelectItem key={member.user_id} value={member.user_id}>
                              {nameOf(member.user_id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={area.status}
                        onValueChange={(value) =>
                          setStatus.mutate({ id: area.id, status: value as AreaStatus })
                        }
                      >
                        <SelectTrigger className="h-7 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AREA_STATUSES.map((status) => (
                            <SelectItem key={status.value} value={status.value}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {access.restrictedToAssignments && area.status !== "submitted" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setStatus.mutate({ id: area.id, status: "submitted" })}
                    >
                      Submit area for QA
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {visibleAreas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No work areas yet. A manager creates them during project setup.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
