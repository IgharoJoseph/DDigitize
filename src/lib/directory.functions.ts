import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ projectId: z.string().uuid() });

export type DirectoryEntry = {
  id: string;
  display_name: string | null;
  username: string | null;
};

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type Row = Record<string, unknown>;
type AuthedContext = {
  userId: string;
  supabase: {
    rpc: (
      fn: "project_authority",
      args: { _user_id: string; _project_id: string },
    ) => Result<number>;
  };
};

/**
 * Accounts a project manager may add to their team. Profiles are no longer
 * world-readable, so the candidate list comes from here instead: the caller's
 * authority on the project is checked server-side first, and only the name and
 * username are returned — never email addresses.
 */
export const listAssignableAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }): Promise<DirectoryEntry[]> => {
    const { supabase, userId } = context as unknown as AuthedContext;

    const authority = await supabase.rpc("project_authority", {
      _user_id: userId,
      _project_id: data.projectId,
    });
    if (authority.error) throw new Error(authority.error.message);
    if ((authority.data ?? 0) < 50) {
      throw new Error("Only a project manager or administrator can change the team.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, username")
      .order("display_name");
    if (error) throw new Error(error.message);

    return ((rows ?? []) as Row[]).map((row) => ({
      id: String(row["id"]),
      display_name: (row["display_name"] as string | null) ?? null,
      username: (row["username"] as string | null) ?? null,
    }));
  });
