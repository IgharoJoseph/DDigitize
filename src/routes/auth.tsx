import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Radar } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { isUsernameValid, normalizeUsername } from "@/lib/username";
import { signInWithUsername } from "@/lib/users.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — DDigitize" },
      {
        name: "description",
        content: "Sign in to DDigitize to digitize drone imagery with your mapping team.",
      },
      { property: "og:title", content: "Sign in to DDigitize" },
      {
        property: "og:description",
        content: "Contributor and admin access for collaborative drone imagery digitizing.",
      },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, { message: "Enter your email address or username" })
    .max(255),
  password: z.string().min(8, { message: "Use at least 8 characters" }).max(72),
  displayName: z.string().trim().max(60).optional(),
  username: z.string().trim().max(40).optional(),
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const usernameSignIn = useServerFn(signInWithUsername);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/" });
  }, [user, loading, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({ identifier, password, displayName, username });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!parsed.data.identifier.includes("@")) {
          toast.error("Enter a valid email address to create an account");
          return;
        }
        const chosen = parsed.data.username?.trim() ? normalizeUsername(parsed.data.username) : "";
        if (chosen && !isUsernameValid(chosen)) {
          toast.error("A username needs at least 3 letters or numbers");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.identifier.toLowerCase(),
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: parsed.data.displayName || chosen,
              ...(chosen ? { username: chosen } : {}),
            },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Account created — check your email to confirm, then sign in.");
          setMode("signin");
          return;
        }
        void navigate({ to: "/" });
      } else if (parsed.data.identifier.includes("@")) {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.identifier.toLowerCase(),
          password: parsed.data.password,
        });
        if (error) throw error;
        void navigate({ to: "/" });
      } else {
        const result = await usernameSignIn({
          data: {
            username: normalizeUsername(parsed.data.identifier),
            password: parsed.data.password,
          },
        });
        if (!result.ok) throw new Error(result.message);
        const { error } = await supabase.auth.setSession({
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
        });
        if (error) throw error;
        void navigate({ to: "/" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete that request");
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setBusy(false);
      toast.error("Google sign-in failed. Use your username instead.");
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm border-border bg-panel">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <Radar className="size-5 text-primary" />
            <CardTitle className="text-lg">DDigitize</CardTitle>
          </div>
          <CardDescription>
            Sign in with your email address or username. The first account created becomes the
            project admin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
          </Tabs>

          <form className="space-y-3" onSubmit={submit}>
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="username">Username (optional)</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  maxLength={40}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="so you can sign in without your email"
                />
              </div>
            )}
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={displayName}
                  maxLength={60}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Field surveyor"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="identifier">
                {mode === "signup" ? "Email" : "Email or username"}
              </Label>
              <Input
                id="identifier"
                autoComplete={mode === "signup" ? "email" : "username"}
                value={identifier}
                maxLength={255}
                placeholder={mode === "signup" ? "you@example.com" : "you@example.com or username"}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
              {mode === "signin" && (
                <p className="text-[11px] text-muted-foreground">
                  Either works — your email address or the username set on your account.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                maxLength={72}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void googleSignIn()}
          >
            Continue with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
