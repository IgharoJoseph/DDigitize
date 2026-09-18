import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AuthedContext = {
  supabase: {
    rpc: (
      fn: "app_rank",
      args: { _user_id: string },
    ) => PromiseLike<{ data: number | null; error: { message: string } | null }>;
  };
};
import { normalizeUsername } from "@/lib/username";

const input = z.object({
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(200),
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .transform(normalizeUsername)
    .refine((value) => value.length >= 3, { message: "Use at least 3 letters or numbers" }),
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(72).optional(),
  makeAdmin: z.boolean().default(false),
});

function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * Authority on one shared scale: owner 100, admin 90, everyone else 0. You can
 * only act on an account whose authority is strictly below your own, so an
 * admin can never take over the owner's account or another admin's.
 */
async function authorityOf(supabase: AuthedContext["supabase"], userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("app_rank", { _user_id: userId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Admin-only account creation. The account is created already confirmed so the
 * credentials can be handed to a tester directly, with no email round trip.
 */
export const createUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const actor = await authorityOf(context.supabase, context.userId);
    if (actor < 90) throw new Error("Only an admin can create accounts");
    if (data.makeAdmin && actor < 100) {
      throw new Error("Only the project owner can grant full admin access");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username)
      .maybeSingle();
    if (taken) throw new Error("That username is already taken");

    const email = data.email.toLowerCase();
    const password = data.password?.trim() || randomPassword();
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: data.displayName, username: data.username },
    });
    if (error) throw new Error(error.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("The account could not be created");

    // The signup trigger creates the profile and the contributor role; keep the
    // username and display name in step and add the admin role only when asked.
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, email, display_name: data.displayName, username: data.username });

    if (data.makeAdmin) {
      const { error: grantError } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });
      if (grantError && !grantError.message.includes("duplicate")) {
        throw new Error(grantError.message);
      }
    }

    return { userId, email, username: data.username, password };
  });

const resetInput = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8).max(72).optional(),
});

/** Admin-only password reset so a handed-over account can be recovered. */
export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => resetInput.parse(data))
  .handler(async ({ data, context }) => {
    const actor = await authorityOf(context.supabase, context.userId);
    if (actor < 90) throw new Error("Only an admin can reset passwords");
    const target = await authorityOf(context.supabase, data.userId);
    if (data.userId !== context.userId && target >= actor) {
      throw new Error("You cannot change the password of an account at or above your own level");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const password = data.password?.trim() || randomPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password });
    if (error) throw new Error(error.message);
    return { password };
  });

const changeInput = z.object({
  currentPassword: z.string().min(1, { message: "Enter your current password" }).max(72),
  newPassword: z.string().min(8, { message: "Use at least 8 characters" }).max(72),
});

/**
 * Self-service password change. The current password is checked server-side
 * against the signed-in account, so the browser session is never disturbed and
 * username-only accounts work the same as email ones.
 */
export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => changeInput.parse(data))
  .handler(async ({ data, context }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: found, error: lookupError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    if (lookupError) throw new Error(lookupError.message);
    const email = found.user?.email;
    if (!email) throw new Error("This account has no email address to verify against");

    const client = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { error: verifyError } = await client.auth.signInWithPassword({
      email,
      password: data.currentPassword,
    });
    if (verifyError) throw new Error("Your current password is incorrect");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const signInInput = z.object({
  username: z.string().trim().min(1).max(40).transform(normalizeUsername),
  password: z.string().min(1).max(72),
});

/**
 * Username sign-in. Email addresses are never returned to the browser: the
 * username is resolved server-side and the password is checked there, so a
 * session only comes back when the credentials are actually correct.
 */
export const signInWithUsername = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => signInInput.parse(data))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("username", data.username)
      .maybeSingle();

    const failure = { ok: false as const, message: "Wrong username or password" };
    if (!profile?.email) return failure;

    const client = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data: signedIn, error } = await client.auth.signInWithPassword({
      email: profile.email,
      password: data.password,
    });
    if (error || !signedIn.session) return failure;

    return {
      ok: true as const,
      accessToken: signedIn.session.access_token,
      refreshToken: signedIn.session.refresh_token,
    };
  });
