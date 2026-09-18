import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function rpcBool(supabase: Rpc, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function rpcNumber(supabase: Rpc, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Constant-time-ish comparison so the bootstrap token cannot be guessed byte by byte. */
function sameToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Secure bootstrap for platform administration. Registering first grants
 * nothing: a signed-in account becomes a platform administrator only by
 * presenting the server-held bootstrap token, and only while no platform owner
 * exists yet. After that, administration is granted by an existing
 * administrator through setSystemRole.
 */
export const claimPlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ token: z.string().min(8).max(200) }).parse(raw))
  .handler(async ({ data, context }) => {
    const expected = process.env["PLATFORM_BOOTSTRAP_TOKEN"];
    if (!expected) throw new Error("No bootstrap token is configured on the server");
    if (!sameToken(data.token.trim(), expected))
      throw new Error("That bootstrap token is not valid");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("app_owners")
      .select("user_id", { count: "exact", head: true });

    if ((count ?? 0) > 0) {
      const { data: mine } = await supabaseAdmin
        .from("app_owners")
        .select("user_id")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!mine) {
        throw new Error(
          "Platform administration is already provisioned. Ask an administrator to grant your role.",
        );
      }
      return { ok: true as const, alreadyOwner: true };
    }

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "admin" }, { onConflict: "user_id,role" });
    await supabaseAdmin
      .from("app_owners")
      .upsert({ user_id: context.userId }, { onConflict: "user_id" });

    return { ok: true as const, alreadyOwner: false };
  });

const roleInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["contributor", "manager", "admin"]),
  grant: z.boolean().default(true),
});

/**
 * System-role administration. Only a platform administrator may change system
 * roles; only the platform owner may grant or remove administration itself, and
 * nobody may change their own role or the owner's.
 */
export const setSystemRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => roleInput.parse(raw))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as Rpc;
    const actorRank = await rpcNumber(supabase, "app_rank", { _user_id: context.userId });
    if (actorRank < 90) throw new Error("Only a platform administrator can change system roles");
    if (data.userId === context.userId) throw new Error("You cannot change your own system role");
    if (await rpcBool(supabase, "is_owner", { _user_id: data.userId })) {
      throw new Error("The platform owner's role cannot be changed");
    }
    if (data.role === "admin" && actorRank < 100) {
      throw new Error("Only the platform owner can grant platform administration");
    }
    const targetRank = await rpcNumber(supabase, "app_rank", { _user_id: data.userId });
    if (targetRank >= actorRank) {
      throw new Error("You cannot change the role of an account at or above your own level");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
      if (error) throw new Error(error.message);
    } else {
      if (data.role === "contributor") {
        throw new Error("The contributor role cannot be removed");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("activity_log").insert({
      user_id: context.userId,
      action: data.grant ? "role.granted" : "role.revoked",
      detail: `${data.userId} ${data.role}`,
      source: "system",
    });

    return { ok: true as const };
  });
