import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useRoleSimulation } from "@/hooks/useRoleSimulation";
import { areaProgress, countByStatus, fetchOverview, ok } from "@/lib/overview";
import { fetchMyMemberships, fetchProjects, pk } from "@/lib/projects";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Production dashboard — DroneTrace" },
      {
        name: "description",
        content:
          "Live production status across all mapping projects: work-area completion, features awaiting QA and approved output.",
      },
      { property: "og:title", content: "DroneTrace production dashboard" },
      {
        property: "og:description",
        content: "Track digitising progress, QA queues and contributor output per project.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, isAdmin, loading } = useAuth();
  const { activeRole, isSimulating } = useRoleSimulation();

  const overviewQuery = useQuery({
    queryKey: ok.overview,
    queryFn: fetchOverview,
    enabled: Boolean(user),
  });
  const projectsQuery = useQuery({
    queryKey: pk.projects,
    queryFn: fetchProjects,
    enabled: Boolean(user),
  });
  const membershipsQuery = useQuery({
    queryKey: pk.myMemberships,
    queryFn: fetchMyMemberships,
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
  const memberships = membershipsQuery.data ?? [];
  const features = overviewQuery.data?.features ?? [];
  const areas = overviewQuery.data?.areas ?? [];
  const members = overviewQuery.data?.members ?? [];

  const role = isAdmin && isSimulating ? activeRole : "admin";
  const visibleProjects = projects.filter((project) => {
    if (!isSimulating || !isAdmin) {
      return true;
    }
    if (role === "project_owner") return project.created_by === user?.id;
    const membership = memberships.find((m) => m.project_id === project.id);
    if (role === "manager") return membership?.role === "manager";
    if (role === "supervisor") return membership?.role === "supervisor";
    if (role === "contributor") return Boolean(membership && membership.role === "contributor");
    return true;
  });

  const visibleProjectIds = new Set(visibleProjects.map((p) => p.id));
  const scoped = features.filter((f) => {
    if (!f.project_id || !visibleProjectIds.has(f.project_id)) return false;
    if (!isSimulating || role !== "contributor") return true;
    return f.created_by === user?.id;
  });
  const counts = countByStatus(scoped);
  const contributors = new Set(
    members
      .filter((m) => visibleProjectIds.has(m.project_id) && m.role === "contributor")
      .map((m) => m.user_id),
  ).size;
  const activeProjects = visibleProjects.filter((p) => p.status === "active" || p.status === "review");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{isSimulating ? `${activeRole === "project_owner" ? "Project Owner" : activeRole.charAt(0).toUpperCase() + activeRole.slice(1)} dashboard` : "Platform dashboard"}</h1>
          <p className="text-sm text-muted-foreground">
            {isSimulating
              ? "Previewing the workspace, project visibility and controls available to this role."
              : "Platform-wide production status across projects, teams and QA."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Projects" value={visibleProjects.length} />
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
            {visibleProjects.length === 0 && (
              <p className="text-sm text-muted-foreground">No projects visible in this role.</p>
            )}
            {visibleProjects.map((project) => {
              const projectAreas = areas.filter((a) => a.project_id === project.id);
              const projectFeatures = features.filter((f) => f.project_id === project.id);
              const ap = areaProgress(projectAreas);
              const fc = countByStatus(projectFeatures);
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

        {isAdmin && !isSimulating && (
          <Card className="bg-panel">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Platform administration</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <AdminLink to="/audit" title="Audit log" description="Review system activity and security events." />
              <AdminLink to="/export" title="Data exports" description="Access authorised project exports." />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function AdminLink({ to, title, description }: { to: "/audit" | "/export"; title: string; description: string }) {
  return (
    <Link to={to} className="rounded border border-border p-3 transition-colors hover:bg-secondary">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </Link>
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
