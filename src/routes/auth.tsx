import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Radar } from "lucide-react";
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

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — DroneTrace" },
      {
        name: "description",
        content: "Sign in to DroneTrace to digitize drone imagery with your mapping team.",
      },
      { property: "og:title", content: "Sign in to DroneTrace" },
      {
        property: "og:description",
        content: "Contributor and admin access for collaborative drone imagery digitizing.",
      },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(255),
  password: z.string().min(8, { message: "Use at least 8 characters" }).max(72),
  displayName: z.string().trim().max(60).optional(),
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/" });
  }, [user, loading, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({ email, password, displayName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: parsed.data.displayName || parsed.data.email.split("@")[0] },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Account created — check your inbox to confirm your email.");
          return;
        }
        void navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: parsed.data.email,
          password: parsed.data.password,
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
      toast.error("Google sign-in failed. Try email instead.");
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm border-border bg-panel">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <Radar className="size-5 text-primary" />
            <CardTitle className="text-lg">DroneTrace</CardTitle>
          </div>
          <CardDescription>
            Sign in to digitize features. The first account created becomes the project admin.
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                maxLength={255}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
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
