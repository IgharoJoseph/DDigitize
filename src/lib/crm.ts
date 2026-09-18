import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ContactRow = Database["public"]["Tables"]["client_contacts"]["Row"];

type ProjectClientRow = Database["public"]["Tables"]["project_clients"]["Row"];

export async function fetchClients(): Promise<ClientRow[]> {
  const { data, error } = await supabase.from("clients").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createClient(input: Omit<ClientInsert, "id" | "created_at" | "updated_at">): Promise<ClientRow> {
  const { data, error } = await supabase.from("clients").insert(input).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchClientContacts(clientId: string): Promise<ContactRow[]> {
  const { data, error } = await supabase.from("client_contacts").select("*").eq("client_id", clientId).order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchProjectClients(projectId: string): Promise<ProjectClientRow[]> {
  const { data, error } = await supabase.from("project_clients").select("*").eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
