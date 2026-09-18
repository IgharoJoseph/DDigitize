import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchProject, pk, updateProject } from "@/lib/projects";

/**
 * Project record: name, description, client reference, coordinate system and
 * dates. Ownership, members and status are handled elsewhere and stay there.
 */
export function DetailsTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });
  const project = projectQuery.data;

  const [form, setForm] = useState({
    name: "",
    description: "",
    client_ref: "",
    crs: "EPSG:4326",
    start_date: "",
    due_date: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name,
      description: project.description ?? "",
      client_ref: project.client_ref ?? "",
      crs: project.crs,
      start_date: project.start_date ?? "",
      due_date: project.due_date ?? "",
    });
  }, [project]);

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("The project needs a name");
      return;
    }
    setBusy(true);
    try {
      await updateProject(projectId, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        client_ref: form.client_ref.trim() || null,
        crs: form.crs.trim() || "EPSG:4326",
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: pk.projects });
      toast.success("Project details saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Project details</h2>
        <p className="text-sm text-muted-foreground">
          Who the work is for, when it runs, and the coordinate system it is recorded in.
        </p>
      </div>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">Record</CardTitle>
          <CardDescription>
            Shapes are always stored as longitude / latitude in WGS84; this is the delivery
            coordinate system quoted to the client.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              maxLength={120}
              onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Client / reference</Label>
            <Input
              value={form.client_ref}
              maxLength={80}
              onChange={(event) => setForm((c) => ({ ...c, client_ref: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Delivery coordinate system</Label>
            <Input
              value={form.crs}
              maxLength={40}
              onChange={(event) => setForm((c) => ({ ...c, crs: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input
              type="date"
              value={form.start_date}
              onChange={(event) => setForm((c) => ({ ...c, start_date: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input
              type="date"
              value={form.due_date}
              onChange={(event) => setForm((c) => ({ ...c, due_date: event.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Button disabled={busy} onClick={() => void save()}>
              Save details
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
