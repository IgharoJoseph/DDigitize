import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess, useProjectAreas } from "@/hooks/useProjectRole";
import {
  featureAttributes,
  fetchCategories,
  fetchFeatures,
  fetchProfiles,
  fetchRemovedFeatures,
  logActivity,
  qk,
  restoreFeature,
  reviewStatusLabel,
  updateFeature,
  type ReviewStatus,
} from "@/lib/data";
import { formatArea, formatLength } from "@/lib/geo";

export const Route = createFileRoute("/p/$projectId/review")({
  component: ReviewPage,
});

function ReviewPage() {
  const { projectId } = Route.useParams();
  const { user } = useAuth();
  const access = useProjectAccess(projectId);
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

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
  const areasQuery = useProjectAreas(projectId);

  const categories = categoriesQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  // Only submitted work enters the formal queue; drafts stay with their author.
  const queue = (featuresQuery.data ?? []).filter(
    (row) => row.status === "submitted" || row.status === "under_review",
  );
  const removedQuery = useQuery({
    queryKey: qk.removedFeatures(projectId),
    queryFn: () => fetchRemovedFeatures(projectId),
    enabled: Boolean(user) && access.canManage,
  });
  const removed = removedQuery.data ?? [];

  if (!access.loading && !access.canReview) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          Only supervisors and managers can review submitted work.
        </p>
      </div>
    );
  }

  const name = (id: string | null) => {
    const profile = profiles.find((item) => item.id === id);
    return profile?.display_name ?? profile?.email ?? "Unknown";
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.features(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.activity(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.removedFeatures(projectId) });
  };

  // Submitted work is taken up for review first, then approved or sent back;
  // the database enforces the same order.
  const move = async (id: string, next: ReviewStatus) => {
    const note = notes[id]?.trim() ?? "";
    if (next === "needs_revision" && note.length < 3) {
      toast.error("Leave a short note so the contributor knows what to fix");
      return;
    }
    try {
      await updateFeature(id, {
        status: next,
        ...(note ? { reviewNote: note } : {}),
      });
      const wording: Record<string, string> = {
        under_review: "Started reviewing a feature",
        verified: "Approved a feature",
        needs_revision: `Requested changes: ${note}`,
      };
      await logActivity(projectId, `review.${next}`, wording[next] ?? "Reviewed a feature", id);
      refresh();
      toast.success(
        next === "verified"
          ? "Approved"
          : next === "needs_revision"
            ? "Sent back for changes"
            : "Review started",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that decision");
    }
  };

  const restore = async (id: string) => {
    try {
      await restoreFeature(id);
      await logActivity(projectId, "feature.restore", "Restored removed work", id);
      refresh();
      toast.success("Restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore that feature");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Review queue</h1>
          <p className="text-sm text-muted-foreground">
            {queue.length} submitted feature{queue.length === 1 ? "" : "s"} waiting for a decision.
          </p>
        </div>

        {queue.map((row) => {
          const category = categories.find((item) => item.id === row.category_id);
          const attributes = featureAttributes(row);
          return (
            <Card key={row.id} className="bg-panel">
              <CardHeader className="flex-row items-start gap-2 space-y-0">
                <span
                  className="mt-1 size-2.5 rounded-sm"
                  style={{ backgroundColor: category?.color ?? "#94a3b8" }}
                />
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-base">{category?.name ?? "Uncategorised"}</CardTitle>
                  <CardDescription className="text-xs">
                    {name(row.created_by)} ·{" "}
                    {areas.find((area) => area.id === row.work_area_id)?.name ?? "no area"} ·{" "}
                    {Number(row.area_sqm) > 0
                      ? formatArea(Number(row.area_sqm))
                      : formatLength(Number(row.length_m))}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-[9px] uppercase">
                  {reviewStatusLabel(row.status)}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(attributes).length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-border bg-card/60 p-2 text-xs">
                    {Object.entries(attributes).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd className="truncate">{String(value ?? "—")}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <Textarea
                  className="min-h-16 text-xs"
                  maxLength={600}
                  placeholder="Note for the contributor (required when asking for changes)"
                  value={notes[row.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  {row.status === "submitted" && (
                    <Button size="sm" onClick={() => void move(row.id, "under_review")}>
                      Start review
                    </Button>
                  )}
                  {row.status === "under_review" && (
                    <>
                      <Button size="sm" onClick={() => void move(row.id, "verified")}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void move(row.id, "needs_revision")}
                      >
                        Request changes
                      </Button>
                    </>
                  )}
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/p/$projectId" params={{ projectId }}>
                      Open on the map
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {queue.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing waiting for review right now.</p>
        )}

        {access.canManage && removed.length > 0 && (
          <Card className="bg-panel">
            <CardHeader>
              <CardTitle className="text-base">Removed work</CardTitle>
              <CardDescription className="text-xs">
                Kept on record so nothing disappears without a trace. You can bring any of it back.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {removed.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 p-2 text-xs"
                >
                  <span className="font-medium">
                    {categories.find((item) => item.id === row.category_id)?.name ??
                      "Uncategorised"}
                  </span>
                  <span className="text-muted-foreground">
                    {name(row.created_by)} · removed{" "}
                    {row.deleted_at ? new Date(row.deleted_at).toLocaleString() : "—"} ·{" "}
                    {row.deletion_reason ?? "no reason given"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => void restore(row.id)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
