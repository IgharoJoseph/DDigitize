import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type SimulatedRole = "admin" | "manager" | "project_owner" | "supervisor" | "contributor";

export const SIMULATED_ROLES: { value: SimulatedRole; label: string; description: string }[] = [
  { value: "manager", label: "Manager", description: "Project management, setup and team controls." },
  { value: "project_owner", label: "Project Owner", description: "Full control of projects you own." },
  { value: "supervisor", label: "Supervisor", description: "QA, review and team progress." },
  { value: "contributor", label: "Contributor", description: "Assigned-area digitising and submission." },
];

type RoleSimulationState = {
  activeRole: SimulatedRole;
  isSimulating: boolean;
  enterRole: (role: Exclude<SimulatedRole, "admin">) => void;
  exitRole: () => void;
};

const RoleSimulationContext = createContext<RoleSimulationState | null>(null);

export function RoleSimulationProvider({ children }: { children: ReactNode }) {
  const [activeRole, setActiveRole] = useState<SimulatedRole>("admin");

  const value = useMemo<RoleSimulationState>(
    () => ({
      activeRole,
      isSimulating: activeRole !== "admin",
      enterRole: (role) => setActiveRole(role),
      exitRole: () => setActiveRole("admin"),
    }),
    [activeRole],
  );

  return <RoleSimulationContext.Provider value={value}>{children}</RoleSimulationContext.Provider>;
}

export function useRoleSimulation(): RoleSimulationState {
  const context = useContext(RoleSimulationContext);
  if (!context) throw new Error("useRoleSimulation must be used inside RoleSimulationProvider");
  return context;
}
