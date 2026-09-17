import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  createProject,
  fetchMyMemberships,
  fetchProjects,
  pk,
  type Project,
} from "@/lib/projects";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Projects — DroneTrace" },
      {
        name: "description",
        content:
          "Pick a drone mapping project to open. Managers set up feature layers, imagery and work areas; contributors digitize the area assigned to them.",
      },
      { property: "og:title", content: "DroneTrace projects" },
      {
        property: "og:description",
        content: "Collaborative drone imagery digitizing, organised per project and per role.",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", description: "" });

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

  const projects = projectsQuery.data ?? [];
  const memberships = membershipsQuery.data ?? [];

  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first");
      const name = form.name.trim();
      if (name.length < 2) throw new Error("Give the project a name");
      return createProject({
        name: name.slice(0, 80),
        description: form.description.trim().slice(0, 400) || null,
        createdBy: user.id,
      });
    },
    onSuccess: () => {
      setForm({ name: "", description: "" });
      void queryClient.invalidateQueries({ queryKey: pk.projects });
      void queryClient.invalidateQueries({ queryKey: pk.myMemberships });
      toast.success("Project created — set up its layers, imagery and areas next.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create the project"),
  });

  if (!loading && !user) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold tracking-tight">DroneTrace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to see the mapping projects you have been added to.
          </p>
          <Button asChild className="mt-4">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  const roleFor = (project: Project) =>
    isAdmin
      ? "admin"
      : (memberships.find((row) => row.project_id === project.id)?.role ?? null);

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project has its own feature layers, imagery, work areas and team.
          </p>
        </div>

        {isAdmin && (
          <Card className="bg-panel">
            <CardHeader>
              <CardTitle className="text-base">New project</CardTitle>
              <CardDescription>
                You will join as its manager, so you can set it up straight away and hand it over
                later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-name">Name</Label>
                <Input
                  id="p-name"
                  value={form.name}
                  maxLength={80}
                  placeholder="Kisumu ward mapping"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-desc">What is being mapped?</Label>
                <Textarea
                  id="p-desc"
                  value={form.description}
                  maxLength={400}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </div>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                <Plus className="mr-1.5 size-4" /> Create project
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {projects.map((project) => {
            const role = roleFor(project);
            return (
              <Card key={project.id} className="bg-panel">
                <CardHeader className="flex-row items-start gap-3 space-y-0">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">{project.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {project.description ?? "No description yet."}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="outline" className="text-[9px] uppercase">
                      {project.status}
                    </Badge>
                    {role && (
                      <Badge className="text-[9px] uppercase">
                        {role === "admin" ? "app admin" : role}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link to="/p/$projectId" params={{ projectId: project.id }}>
                      Open workspace <ArrowRight className="ml-1.5 size-3.5" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/p/$projectId/progress" params={{ projectId: project.id }}>
                      Progress
                    </Link>
                  </Button>
                  {(role === "admin" || role === "manager") && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/p/$projectId/setup" params={{ projectId: project.id }}>
                        Set up
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {!projectsQuery.isLoading && projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You are not on any project yet. Ask an administrator to add you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
