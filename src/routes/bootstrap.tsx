import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { claimPlatformAdmin } from "@/lib/roles.functions";

export const Route = createFileRoute("/bootstrap")({
  head: () => ({
    meta: [
      { title: "Provision platform administration — DDigitize" },
      {
        name: "description",
        content:
          "One-time provisioning of the DDigitize platform administrator using the server bootstrap token.",
      },
      { property: "og:title", content: "Provision platform administration" },
      {
        property: "og:description",
        content: "Signed-in accounts become platform administrator only with the bootstrap token.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BootstrapPage,
});

function BootstrapPage() {
  const { user, isAdmin, loading } = useAuth();
  const claim = useServerFn(claimPlatformAdmin);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await claim({ data: { token: token.trim() } });
      setDone(true);
      setToken("");
      toast.success("This account is now the platform administrator. Sign out and back in.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That request was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" /> Platform administration
          </CardTitle>
          <CardDescription>
            Registering an account grants nothing but contributor access. The first platform
            administrator is provisioned here with the bootstrap token held on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Checking your access…</p>
          ) : !user ? (
            <p className="text-sm text-muted-foreground">
              <Link to="/auth" className="underline">
                Sign in
              </Link>{" "}
              first, then return to this page.
            </p>
          ) : done || isAdmin ? (
            <p className="text-sm text-muted-foreground">
              This account already holds platform administration.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="bootstrap-token">Bootstrap token</Label>
                <Input
                  id="bootstrap-token"
                  value={token}
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Paste the token from your server settings"
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
              <Button onClick={() => void submit()} disabled={busy || token.trim().length < 8}>
                Provision this account
              </Button>
              <p className="text-xs text-muted-foreground">
                The token only works while no platform administrator exists. Afterwards, roles are
                granted by an existing administrator.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
