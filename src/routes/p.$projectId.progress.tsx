import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess, useProjectAreas } from "@/hooks/useProjectRole";
import {
  fetchActivity,
  fetchCategories,
  fetchFeatures,
  fetchProfiles,
  qk,
  type FeatureRow,
} from "@/lib/data";
import { formatArea, formatLength } from "@/lib/geo";
import { fetchAssignments, pk } from "@/lib/projects";

export const Route = createFileRoute("/p/$projectId/progress")({
  component: ProgressPage,
});

function ProgressPage() {
  const { projectId } = Route.useParams();
  const { user } = useAuth();
  const access = useProjectAccess(projectId);

  const featuresQuery = useQuery({
    queryKey: qk.features(projectId),
    queryFn: () => fetchFeatures(projectId),
    enabled: Boolean(user),
  });
  const categoriesQuery = useQuery({
    queryKey: qk.categories(projectId),
    queryFn: () => fetchCategories(projectId),
    enabled: Boolean(user),
  });
  const profilesQuery = useQuery({ queryKey: qk.profiles, queryFn: fetchProfiles });
  const activityQuery = useQuery({
    queryKey: qk.activity(projectId),
    queryFn: () => fetchActivity(projectId),
    enabled: Boolean(user),
  });
  const assignmentsQuery = useQuery({
    queryKey: pk.assignments(projectId),
    queryFn: () => fetchAssignments(projectId),
    enabled: Boolean(user),
  });
  const areasQuery = useProjectAreas(projectId);

  const allFeatures = featuresQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const activity = activityQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];

  // Contributors only ever see their own numbers.
  const teamView = access.canSeeTeamProgress;
  const features = useMemo(
    () => (teamView ? allFeatures : allFeatures.filter((row) => row.created_by === user?.id)),
    [allFeatures, teamView, user?.id],
  );

  const name = (id: string | null) => {
    const profile = profiles.find((item) => item.id === id);
    return profile?.display_name ?? profile?.email ?? "Unknown";
  };

  const totals = summarise(features);
  const byStatus = (status: string) => features.filter((row) => row.status === status).length;

  const perPerson = useMemo(() => {
    const ids = Array.from(new Set(features.map((row) => row.created_by)));
    return ids
      .map((id) => ({
        id,
        name: name(id),
        ...summarise(features.filter((r) => r.created_by === id)),
      }))
      .sort((a, b) => b.count - a.count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, profiles]);

  const myAreas = areas.filter((area) =>
    teamView ? true : access.assignedAreaIds.includes(area.id),
  );

  const sentBack = features.filter((row) => row.status === "needs_revision");

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {teamView ? "Team progress" : "My progress"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {teamView
              ? "Everything digitized on this project, by person and by area."
              : "Your own digitizing on this project."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Features" value={String(totals.count)} />
          <Metric label="Area mapped" value={formatArea(totals.area)} />
          <Metric label="Line length" value={formatLength(totals.length)} />
          <Metric label="Verified" value={String(byStatus("verified"))} />
        </div>

        {sentBack.length > 0 && (
          <Card className="border-warning/40 bg-warning/5">
            <CardHeader>
              <CardTitle className="text-base">Sent back for revision</CardTitle>
              <CardDescription>Fix these on the map, then submit again.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sentBack.slice(0, 20).map((row) => (
                <div
                  key={row.id}
                  className="rounded border border-border bg-card/60 px-3 py-2 text-xs"
                >
                  <p className="font-medium">
                    {categories.find((item) => item.id === row.category_id)?.name ?? "Feature"}
                  </p>
                  <p className="text-muted-foreground">
                    {row.review_note ?? "No note left by the reviewer."}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">By feature layer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {categories.map((category) => {
              const count = features.filter((row) => row.category_id === category.id).length;
              const share = totals.count === 0 ? 0 : Math.round((count / totals.count) * 100);
              return (
                <div key={category.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ backgroundColor: category.color }}
                    />
                    <span>{category.name}</span>
                    <span className="readout ml-auto text-muted-foreground">
                      {count} · {share}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-secondary">
                    <div
                      className="h-full rounded"
                      style={{ width: `${share}%`, backgroundColor: category.color }}
                    />
                  </div>
                </div>
              );
            })}
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground">No feature layers defined yet.</p>
            )}
          </CardContent>
        </Card>

        {teamView && (
          <Card className="bg-panel">
            <CardHeader>
              <CardTitle className="text-base">Contributors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {perPerson.map((person) => (
                <div
                  key={person.id ?? "unknown"}
                  className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{person.name}</span>
                  <span className="readout text-muted-foreground">{person.count} features</span>
                  <span className="readout text-muted-foreground">{formatArea(person.area)}</span>
                  <span className="readout text-muted-foreground">
                    {formatLength(person.length)}
                  </span>
                </div>
              ))}
              {perPerson.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing digitized yet.</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">{teamView ? "Work areas" : "My work areas"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {myAreas.map((area) => {
              const rows = features.filter((row) => row.work_area_id === area.id);
              const holders = assignments
                .filter((row) => row.work_area_id === area.id)
                .map((row) => name(row.user_id));
              return (
                <div
                  key={area.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{area.name}</span>
                  {teamView && (
                    <span className="truncate text-muted-foreground">
                      {holders.length > 0 ? holders.join(", ") : "unassigned"}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[9px] uppercase">
                    {area.status.replace("_", " ")}
                  </Badge>
                  <span className="readout text-muted-foreground">{rows.length} features</span>
                </div>
              );
            })}
            {myAreas.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {teamView
                  ? "No work areas created yet."
                  : "No work area assigned to you yet — ask your manager."}
              </p>
            )}
          </CardContent>
        </Card>

        {teamView && (
          <Card className="bg-panel">
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {activity.map((row) => (
                <p key={row.id} className="text-xs text-muted-foreground">
                  <span className="text-foreground">{name(row.user_id)}</span> {row.detail}
                  <span className="readout ml-2 text-[10px]">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </p>
              ))}
              {activity.length === 0 && (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function summarise(rows: FeatureRow[]) {
  return {
    count: rows.length,
    area: rows.reduce((sum, row) => sum + Number(row.area_sqm ?? 0), 0),
    length: rows.reduce((sum, row) => sum + Number(row.length_m ?? 0), 0),
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="bg-panel">
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="readout mt-1 text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
