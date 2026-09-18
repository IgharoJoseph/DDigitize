import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useRoleSimulation } from "@/hooks/useRoleSimulation";
import { createClient, fetchClients } from "@/lib/crm";
import { fetchMyMemberships, fetchProjects } from "@/lib/projects";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/management")({ component: ManagementPage });

function ManagementPage() {
  const { user, isAdmin } = useAuth();
  const { activeRole, isSimulating } = useRoleSimulation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", clientRef: "", industry: "", email: "", phone: "", notes: "" });

  const clientsQuery = useQuery({ queryKey: ["clients"], queryFn: fetchClients, enabled: Boolean(user) });
  const membershipsQuery = useQuery({ queryKey: ["my-memberships"], queryFn: fetchMyMemberships, enabled: Boolean(user) && isSimulating });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: fetchProjects, enabled: Boolean(user) && isSimulating });
  const linksQuery = useQuery({
    queryKey: ["project-clients-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_clients").select("project_id, client_id");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(user) && isSimulating,
  });
  const create = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first");
      if (!form.name.trim()) throw new Error("Client name is required");
      return createClient({
        name: form.name.trim().slice(0, 120),
        client_ref: form.clientRef.trim().slice(0, 80) || null,
        industry: form.industry.trim().slice(0, 100) || null,
        email: form.email.trim().slice(0, 200) || null,
        phone: form.phone.trim().slice(0, 50) || null,
        notes: form.notes.trim().slice(0, 1000) || null,
        created_by: user.id,
      });
    },
    onSuccess: () => {
      setForm({ name: "", clientRef: "", industry: "", email: "", phone: "", notes: "" });
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast.success("Client added");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not add client"),
  });

  const canManage = isAdmin && !isSimulating;
  const visibleClientIds = new Set(
    (linksQuery.data ?? [])
      .filter((link) => {
        const project = (projectsQuery.data ?? []).find((item) => item.id === link.project_id);
        if (!project) return false;
        if (activeRole === "project_owner") return project.created_by === user?.id;
        return (membershipsQuery.data ?? []).some((member) => member.project_id === project.id && member.role === "manager");
      })
      .map((link) => link.client_id),
  );
  const visibleClients = isSimulating ? (clientsQuery.data ?? []).filter((client) => visibleClientIds.has(client.id)) : (clientsQuery.data ?? []);
  const title = isSimulating ? `${activeRole.replace("_", " ")} management view` : "Management & CRM";

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">Manage client records and their relationship to delivery projects.</p>
        </div>

        {canManage && (
          <Card className="bg-panel">
            <CardHeader><CardTitle className="text-sm">Add client</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Client name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Reference"><Input value={form.clientRef} onChange={(e) => setForm({ ...form, clientRef: e.target.value })} /></Field>
              <Field label="Industry"><Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Button onClick={() => create.mutate()} disabled={create.isPending}><Plus className="mr-1.5 size-4" /> Add client</Button></div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleClients.map((client) => (
            <Card key={client.id} className="bg-panel">
              <CardHeader className="pb-2">
                <div className="flex items-start gap-2">
                  <Building2 className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm">{client.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{client.industry ?? "No industry"}</p>
                  </div>
                  <Badge variant="outline" className="text-[9px] uppercase">{client.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {client.client_ref && <p>Ref: <span className="text-foreground">{client.client_ref}</span></p>}
                {client.email && <p>{client.email}</p>}
                {client.phone && <p>{client.phone}</p>}
                {client.notes && <p className="pt-1 text-foreground">{client.notes}</p>}
                <p className="flex items-center gap-1 pt-2"><Users className="size-3" /> CRM record</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {!clientsQuery.isLoading && visibleClients.length === 0 && (
          <p className="text-sm text-muted-foreground">No client records are visible to this role.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
