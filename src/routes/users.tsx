import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { fetchAccountLevels, fetchProfiles, qk } from "@/lib/data";
import { isUsernameValid, normalizeUsername } from "@/lib/username";
import { setSystemRole } from "@/lib/roles.functions";
import { createUserAccount, resetUserPassword } from "@/lib/users.functions";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Accounts — DDigitize" },
      {
        name: "description",
        content:
          "Create confirmed accounts for surveyors and testers, and reset a password when one is lost.",
      },
      { property: "og:title", content: "DDigitize accounts" },
      {
        property: "og:description",
        content: "Admin account creation and password resets for the digitising team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersPage,
});

function UsersPage() {
  const { isAdmin, isOwner, user, loading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const create = useServerFn(createUserAccount);
  const reset = useServerFn(resetUserPassword);
  const changeSystemRole = useServerFn(setSystemRole);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{
    email: string;
    username: string;
    password: string;
  } | null>(null);

  const profilesQuery = useQuery({
    queryKey: qk.profiles,
    queryFn: fetchProfiles,
    enabled: isAdmin,
  });
  const levelsQuery = useQuery({
    queryKey: ["account-levels"],
    queryFn: fetchAccountLevels,
    enabled: isAdmin,
  });
  const levels = levelsQuery.data ?? { ownerIds: [], adminIds: [], managerIds: [] };

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Checking your access…</p>;
  }
  if (!isAdmin) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Only an admin can manage accounts.</p>
      </div>
    );
  }

  const toggleManager = async (userId: string, grant: boolean) => {
    setBusy(true);
    try {
      await changeSystemRole({ data: { userId, role: "manager", grant } });
      toast.success(grant ? "Manager role granted" : "Manager role removed");
      void queryClient.invalidateQueries({ queryKey: ["account-levels"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That role change was refused");
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const submit = async () => {
    if (!email.includes("@")) {
      toast.error("Enter the person's email address");
      return;
    }
    if (!isUsernameValid(username) || displayName.trim().length < 2) {
      toast.error("Enter a username of at least 3 characters and a name of at least 2");
      return;
    }
    if (password.trim() && password.trim().length < 8) {
      toast.error("A password you set must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      const result = await create({
        data: {
          email: email.trim(),
          username: normalizeUsername(username),
          displayName: displayName.trim(),
          password: password.trim() || undefined,
          makeAdmin,
        },
      });
      setIssued({ email: result.email, username: result.username, password: result.password });
      setEmail("");
      setUsername("");
      setDisplayName("");
      setPassword("");
      setMakeAdmin(false);
      toast.success("Account created and ready to use");
      void queryClient.invalidateQueries({ queryKey: qk.profiles });
      void router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The account could not be created");
    } finally {
      setBusy(false);
    }
  };

  const resetFor = async (userId: string, label: string) => {
    setBusy(true);
    try {
      const result = await reset({ data: { userId } });
      setIssued({ email: label, username: label, password: result.password });
      toast.success("New password issued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The password could not be reset");
    } finally {
      setBusy(false);
    }
  };

  const profiles = profilesQuery.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Create a ready-to-use account. The person can sign in with either their email address or
          their username, plus the password you hand over. Only the owner can grant admin access,
          and no one can reset the password of an account at or above their own level.
        </p>
      </div>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">New account</CardTitle>
          <CardDescription>
            Leave the password blank and one will be generated for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="u-email">Email</Label>
              <Input
                id="u-email"
                type="email"
                value={email}
                maxLength={200}
                placeholder="tester1@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-name-login">Username</Label>
              <Input
                id="u-name-login"
                value={username}
                maxLength={40}
                placeholder="tester1"
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Name</Label>
              <Input
                id="u-name"
                value={displayName}
                maxLength={80}
                placeholder="Tester One"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pass">Password (optional)</Label>
              <Input
                id="u-pass"
                value={password}
                maxLength={72}
                placeholder="Generated if left blank"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {isOwner && (
              <div className="flex items-end gap-2">
                <Switch id="u-admin" checked={makeAdmin} onCheckedChange={setMakeAdmin} />
                <Label htmlFor="u-admin" className="text-sm font-normal">
                  Give full admin access
                </Label>
              </div>
            )}
          </div>
          <Button onClick={() => void submit()} disabled={busy}>
            <UserPlus className="mr-1.5 size-4" /> Create account
          </Button>

          {issued && (
            <div className="space-y-2 rounded border border-success/40 bg-success/10 p-3 text-xs">
              <p className="font-medium">Hand these over now — the password is not shown again.</p>
              <div className="flex items-center gap-2">
                <code className="readout flex-1 truncate">{issued.email}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Copy email"
                  onClick={() => copy(issued.email)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="readout flex-1 truncate">{issued.username}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Copy username"
                  onClick={() => copy(issued.username)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="readout flex-1 truncate">{issued.password}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Copy password"
                  onClick={() => copy(issued.password)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">People with accounts</CardTitle>
          <CardDescription>
            Add them to a project from its Team tab to give them work areas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile.display_name ?? profile.email}
                </p>
                <p className="readout truncate text-[10px] text-muted-foreground">
                  {profile.username ?? profile.email}
                </p>
              </div>
              {levels.ownerIds.includes(profile.id) && (
                <Badge variant="outline" className="text-[9px] uppercase">
                  Owner
                </Badge>
              )}
              {!levels.ownerIds.includes(profile.id) && levels.adminIds.includes(profile.id) && (
                <Badge variant="outline" className="text-[9px] uppercase">
                  Platform admin
                </Badge>
              )}
              {levels.managerIds.includes(profile.id) && (
                <Badge variant="outline" className="text-[9px] uppercase">
                  Manager
                </Badge>
              )}
              {!levels.ownerIds.includes(profile.id) &&
                !levels.adminIds.includes(profile.id) &&
                profile.id !== user?.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() =>
                      void toggleManager(profile.id, !levels.managerIds.includes(profile.id))
                    }
                  >
                    {levels.managerIds.includes(profile.id) ? "Remove manager" : "Make manager"}
                  </Button>
                )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={
                  busy ||
                  (profile.id !== user?.id &&
                    (levels.ownerIds.includes(profile.id) ||
                      (!isOwner && levels.adminIds.includes(profile.id))))
                }
                onClick={() => void resetFor(profile.id, profile.username ?? profile.email ?? "")}
              >
                <KeyRound className="mr-1.5 size-3.5" /> New password
              </Button>
            </div>
          ))}
          {profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
