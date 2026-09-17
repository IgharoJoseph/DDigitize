import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AreasTab } from "@/components/setup/AreasTab";
import { ImageryTab } from "@/components/setup/ImageryTab";
import { LayersTab } from "@/components/setup/LayersTab";
import { TeamTab } from "@/components/setup/TeamTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectAccess, useProjectAreas } from "@/hooks/useProjectRole";
import { fetchCategories, fetchDatasets, qk } from "@/lib/data";
import {
  PROJECT_STATUSES,
  fetchMembers,
  fetchProject,
  pk,
  updateProject,
  type ProjectStatus,
} from "@/lib/projects";

export const Route = createFileRoute("/p/$projectId/setup")({
  component: SetupPage,
});

const TABS = [
  { id: "layers", label: "Feature layers" },
  { id: "imagery", label: "Imagery" },
  { id: "areas", label: "Work areas" },
  { id: "team", label: "Team" },
] as const;

function SetupPage() {
  const { projectId } = Route.useParams();
  const access = useProjectAccess(projectId);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("layers");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });
  const categoriesQuery = useQuery({
    queryKey: qk.categories(projectId),
    queryFn: () => fetchCategories(projectId),
  });
  const datasetsQuery = useQuery({
    queryKey: qk.datasets(projectId),
    queryFn: () => fetchDatasets(projectId),
  });
  const membersQuery = useQuery({
    queryKey: pk.members(projectId),
    queryFn: () => fetchMembers(projectId),
  });
  const areasQuery = useProjectAreas(projectId);

  if (!access.loading && !access.canManage) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          Only the project manager can change the setup.
        </p>
      </div>
    );
  }

  const checklist = [
    { label: "Feature layers defined", done: (categoriesQuery.data ?? []).length > 0 },
    { label: "Imagery registered", done: (datasetsQuery.data ?? []).length > 0 },
    { label: "Work areas created", done: (areasQuery.data ?? []).length > 0 },
    { label: "Team added", done: (membersQuery.data ?? []).length > 1 },
  ];

  const setStatus = async (status: ProjectStatus) => {
    try {
      await updateProject(projectId, { status });
      void projectQuery.refetch();
      toast.success(`Project marked as ${status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the status");
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Project setup</h1>
            <p className="text-sm text-muted-foreground">
              Everything contributors can do is decided here.
            </p>
          </div>
          <div className="w-40">
            <Select
              value={projectQuery.data?.status ?? "setup"}
              onValueChange={(value) => void setStatus(value as ProjectStatus)}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">Before contributors start</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : (
                  <Circle className="size-4 text-muted-foreground" />
                )}
                <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
          {TABS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={tab === item.id ? "secondary" : "ghost"}
              className="h-8 text-xs"
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {tab === "layers" && <LayersTab projectId={projectId} />}
        {tab === "imagery" && <ImageryTab projectId={projectId} />}
        {tab === "areas" && <AreasTab projectId={projectId} />}
        {tab === "team" && <TeamTab projectId={projectId} />}
      </div>
    </div>
  );
}
