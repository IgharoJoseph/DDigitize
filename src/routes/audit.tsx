import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useRoleSimulation } from "@/hooks/useRoleSimulation";
import { fetchProfiles, qk } from "@/lib/data";
import { fetchAuditLog, ok } from "@/lib/overview";
import { fetchProjects, pk } from "@/lib/projects";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit log — DroneTrace" },
      {
        name: "description",
        content:
          "Who created, edited, submitted, approved or exported what, with the project and timestamp.",
      },
      { property: "og:title", content: "DroneTrace audit log" },
      {
        property: "og:description",
        content: "A complete record of production actions across every project.",
      },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { user, isAdmin, loading } = useAuth();
  const { isSimulating } = useRoleSimulation();

  const logQuery = useQuery({ queryKey: ok.audit, queryFn: () => fetchAuditLog(), enabled: isAdmin });
  const profilesQuery = useQuery({ queryKey: qk.profiles, queryFn: fetchProfiles, enabled: isAdmin });
  const projectsQuery = useQuery({ queryKey: pk.projects, queryFn: fetchProjects, enabled: isAdmin });

  if (!loading && (!isAdmin || isSimulating)) {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-base font-semibold">Administrators only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The audit log is restricted to system administrators.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to={user ? "/dashboard" : "/auth"}>{user ? "Back to dashboard" : "Sign in"}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const rows = logQuery.data ?? [];
  const nameOf = (id: string | null) => {
    if (!id) return "system";
    const profile = (profilesQuery.data ?? []).find((p) => p.id === id);
    return profile?.display_name ?? profile?.email ?? id.slice(0, 8);
  };
  const projectOf = (id: string | null) =>
    (projectsQuery.data ?? []).find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            The {rows.length} most recent recorded actions.
          </p>
        </div>
        <div className="overflow-x-auto rounded border border-border bg-panel">
          <table className="w-full text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Who</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-left font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5">{nameOf(row.user_id)}</td>
                  <td className="px-3 py-1.5">{row.action}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{projectOf(row.project_id)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.detail ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Nothing recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
