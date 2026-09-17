import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess } from "@/hooks/useProjectRole";
import { fetchProject } from "@/lib/projects";

export const Route = createFileRoute("/p/$projectId")({
  head: () => ({
    meta: [
      { title: "Project workspace — DroneTrace" },
      {
        name: "description",
        content:
          "Digitize drone imagery inside your assigned work area, with the feature layers and attributes your manager defined.",
      },
      { property: "og:title", content: "DroneTrace project workspace" },
      {
        property: "og:description",
        content: "Role-based drone imagery digitizing with review and progress tracking.",
      },
    ],
  }),
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const { user, loading } = useAuth();
  const access = useProjectAccess(projectId);
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(user),
  });

  if (!loading && !user) {
    return (
      <Gate
        title="Sign in to open this project"
        body="Projects are private to the team working on them."
        action={<Link to="/auth">Sign in</Link>}
      />
    );
  }

  if (access.loading || projectQuery.isLoading) {
    return <Gate title="Loading project…" body="Checking what you have access to." />;
  }

  if (!access.isMember) {
    return (
      <Gate
        title="You are not on this project"
        body="Ask the project manager to add you, then reload this page."
        action={<Link to="/">Back to projects</Link>}
      />
    );
  }

  const project = projectQuery.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          Projects
        </Link>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="truncate text-xs font-medium">{project?.name ?? "Project"}</span>
        <Badge variant="outline" className="text-[9px] uppercase">
          {access.role === "admin" ? "app admin" : access.role}
        </Badge>
        <nav className="ml-auto flex items-center gap-1">
          <NavLink to="/p/$projectId" projectId={projectId} label="Map" exact />
          <NavLink to="/p/$projectId/tasks" projectId={projectId} label="Tasks" />
          <NavLink to="/p/$projectId/progress" projectId={projectId} label="Progress" />
          {access.canReview && (
            <NavLink to="/p/$projectId/review" projectId={projectId} label="Review" />
          )}
          {access.canManage && (
            <NavLink to="/p/$projectId/setup" projectId={projectId} label="Set up" />
          )}
        </nav>
      </div>
      {/* Required: nested routes render here. */}
      <Outlet />
    </div>
  );
}

function NavLink({
  to,
  projectId,
  label,
  exact,
}: {
  to:
    | "/p/$projectId"
    | "/p/$projectId/tasks"
    | "/p/$projectId/progress"
    | "/p/$projectId/review"
    | "/p/$projectId/setup";
  projectId: string;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      params={{ projectId }}
      activeOptions={{ exact: Boolean(exact) }}
      activeProps={{ className: "bg-secondary text-foreground" }}
      className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {label}
    </Link>
  );
}

function Gate({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {action && (
          <Button asChild className="mt-4" size="sm">
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}
