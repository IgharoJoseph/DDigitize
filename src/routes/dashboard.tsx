import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { fetchOverview, noAreaCounts, noFeatureCounts, ok } from "@/lib/overview";
import { fetchProjects, pk } from "@/lib/projects";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Production dashboard — DDigitize" },
      {
        name: "description",
        content:
          "Live production status across all mapping projects: work-area completion, features awaiting QA and approved output.",
      },
      { property: "og:title", content: "DDigitize production dashboard" },
      {
        property: "og:description",
        content: "Track digitising progress, QA queues and contributor output per project.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, loading, previewRole } = useAuth();
  const asContributor = previewRole === "contributor";

  const overviewQuery = useQuery({
    queryKey: [...ok.overview, asContributor] as const,
    queryFn: () => fetchOverview(asContributor),
    enabled: Boolean(user),
  });
  const projectsQuery = useQuery({
    queryKey: pk.projects,
    queryFn: fetchProjects,
    enabled: Boolean(user),
  });

  if (!loading && !user) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-base font-semibold">Sign in to see production status</h1>
          <Button asChild size="sm" className="mt-4">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  const projects = projectsQuery.data ?? [];
  const featuresByProject = overviewQuery.data?.featuresByProject ?? {};
  const areasByProject = overviewQuery.data?.areasByProject ?? {};

  // Totals come from database aggregates, already scoped: reviewers see the
  // whole project, contributors only their own features.
  const counts = overviewQuery.data?.featureTotals ?? noFeatureCounts();
  const contributors = overviewQuery.data?.contributors ?? 0;
  const activeProjects = projects.filter((p) => p.status === "active" || p.status === "review");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Production dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Digitising and QA status across the projects you have access to.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Projects" value={projects.length} />
          <Stat label="Active" value={activeProjects.length} />
          <Stat label="Contributors" value={contributors} />
          <Stat label="Features" value={counts.total} />
          <Stat label="Awaiting QA" value={counts.submitted + counts.underReview} />
          <Stat label="Approved" value={counts.approved} />
          <Stat label="Corrections" value={counts.correction} />
        </div>

        <Card className="bg-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Project progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            )}
            {projects.map((project) => {
              const ap = areasByProject[project.id] ?? noAreaCounts();
              const fc = featuresByProject[project.id] ?? noFeatureCounts();
              return (
                <div key={project.id} className="rounded border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/p/$projectId"
                      params={{ projectId: project.id }}
                      className="text-sm font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {project.status}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {ap.percent}% complete
                    </span>
                  </div>
                  <Progress value={ap.percent} className="mt-2 h-1.5" />
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                    <Pair label="Areas" value={`${ap.complete}/${ap.total} done`} />
                    <Pair label="In progress" value={ap.inProgress} />
                    <Pair label="Not started" value={ap.notStarted} />
                    <Pair label="Features" value={fc.total} />
                    <Pair label="Awaiting QA" value={fc.submitted + fc.underReview} />
                    <Pair label="Approved" value={fc.approved} />
                    <Pair label="Corrections" value={fc.correction} />
                  </dl>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-panel px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-lg leading-none">{value}</p>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}:</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
