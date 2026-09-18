import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { changeMyPassword } from "@/lib/users.functions";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — DDigitize" },
      {
        name: "description",
        content: "Change your password and update your display name.",
      },
      { property: "og:title", content: "DDigitize settings" },
      {
        property: "og:description",
        content: "Account settings for DDigitize.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, displayName, loading } = useAuth();
  const changePassword = useServerFn(changeMyPassword);

  /* ---- password change ---- */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  /* ---- display name ---- */
  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  if (!user) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Sign in to manage your settings.</p>
      </div>
    );
  }

  const submitPasswordChange = async () => {
    if (!currentPassword) {
      toast.error("Enter your current password first");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The two passwords don't match");
      return;
    }
    if (newPassword === currentPassword) {
      toast.error("The new password must be different from the current one");
      return;
    }
    setPasswordBusy(true);
    try {
      // The current password is verified server-side, so the browser session is
      // never disturbed and username-only accounts work the same way.
      await changePassword({ data: { currentPassword, newPassword } });
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change password");
    } finally {
      setPasswordBusy(false);
    }
  };

  const updateName = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error("Enter a name of at least 2 characters");
      return;
    }
    setNameBusy(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({
        data: { display_name: trimmed },
      });
      if (authError) throw authError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", user.id);
      if (profileError) throw profileError;

      toast.success("Name updated");
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update name");
    } finally {
      setNameBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 pb-16 sm:p-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Change your password and update your display name.
          </p>
        </div>

        {/* ---- account info ---- */}
        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4" /> Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">Email</span>
              <span className="font-mono">{user.email}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">Current name</span>
              <span>{displayName}</span>
            </div>
          </CardContent>
        </Card>

        {/* ---- change password ---- */}
        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" /> Change password
            </CardTitle>
            <CardDescription>Pick a strong password you don't use anywhere else.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-pass">Current password</Label>
              <Input
                id="current-pass"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                maxLength={72}
                placeholder="Enter your current password"
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pass">New password</Label>
              <Input
                id="new-pass"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                maxLength={72}
                placeholder="At least 8 characters"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pass">Confirm password</Label>
              <Input
                id="confirm-pass"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                maxLength={72}
                placeholder="Re-enter the new password"
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button onClick={() => void submitPasswordChange()} disabled={passwordBusy}>
              {passwordBusy ? "Saving…" : "Change password"}
            </Button>
          </CardContent>
        </Card>

        {/* ---- update display name ---- */}
        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">Display name</CardTitle>
            <CardDescription>
              This is the name other team members see on comments and activity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display-name">New display name</Label>
              <Input
                id="display-name"
                value={name}
                maxLength={80}
                placeholder={displayName}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button onClick={() => void updateName()} disabled={nameBusy}>
              {nameBusy ? "Saving…" : "Update name"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
