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
  logActivity,
  qk,
  updateFeature,
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
  const queue = (featuresQuery.data ?? []).filter((row) => row.status === "submitted");

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

  const decide = async (id: string, verified: boolean) => {
    const note = notes[id]?.trim() ?? "";
    if (!verified && note.length < 3) {
      toast.error("Leave a short note so the contributor knows what to fix");
      return;
    }
    try {
      await updateFeature(id, {
        status: verified ? "verified" : "needs_revision",
        reviewNote: note || null,
      });
      await logActivity(
        projectId,
        verified ? "verified" : "sent back",
        verified ? "Verified a feature" : `Sent a feature back: ${note}`,
        id,
      );
      void queryClient.invalidateQueries({ queryKey: qk.features(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.activity(projectId) });
      toast.success(verified ? "Marked as verified" : "Sent back for revision");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that decision");
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
                  submitted
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
                  placeholder="Note for the contributor (required when sending back)"
                  value={notes[row.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void decide(row.id, true)}>
                    Verify
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(row.id, false)}>
                    Send back
                  </Button>
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
      </div>
    </div>
  );
}
