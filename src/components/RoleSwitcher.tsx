import { Eye, Shield, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { SIMULATED_ROLES, useRoleSimulation } from "@/hooks/useRoleSimulation";

export function RoleSwitcher() {
  const { isAdmin } = useAuth();
  const { activeRole, isSimulating, enterRole, exitRole } = useRoleSimulation();

  if (!isAdmin) return null;

  return (
    <div className="flex items-center gap-1.5">
      {isSimulating && (
        <Badge variant="secondary" className="hidden text-[9px] uppercase sm:inline-flex">
          <Eye className="mr-1 size-3" /> Viewing as {activeRole.replace("_", " ")}
        </Badge>
      )}
      <Select
        value={activeRole}
        onValueChange={(value) => {
          if (value !== "admin") enterRole(value as Exclude<typeof activeRole, "admin">);
        }}
      >
        <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="View application as role">
          <div className="flex items-center gap-1.5">
            <Shield className="size-3.5" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          <div className="px-2 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {isSimulating ? "Switch role view" : "Platform Administrator"}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Role view changes the interface only. Your real administrator privilege is unchanged.
            </p>
          </div>
          <SelectItem value="admin" disabled={!isSimulating}>
            Platform Administrator
          </SelectItem>
          {SIMULATED_ROLES.map((role) => (
            <SelectItem key={role.value} value={role.value}>
              <div>
                <div className="text-xs font-medium">{role.label}</div>
                <div className="text-[10px] text-muted-foreground">{role.description}</div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isSimulating && (
        <Button variant="outline" size="icon" className="size-8" onClick={exitRole} aria-label="Exit role view">
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
