import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  /** Organisation-wide manager: operational oversight across projects. */
  isManager: boolean;
  /** UI preview: when set, the app is rendered as if this were the user's role. */
  previewRole: "contributor" | null;
  /** True when the signed-in account really is an admin/owner (ignores preview). */
  canPreviewRoles: boolean;
  setPreviewRole: (role: "contributor" | null) => void;
  /** The single account with ultimate authority: the project owner. */
  isOwner: boolean;
  /** Authority on the shared scale: owner 100, admin 90, otherwise 0. */
  authority: number;
  loading: boolean;
  displayName: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const PREVIEW_KEY = "ddigitize.preview-role";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewRole, setPreviewRoleState] = useState<"contributor" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(PREVIEW_KEY) === "contributor") {
      setPreviewRoleState("contributor");
    }
  }, []);

  const setPreviewRole = (role: "contributor" | null) => {
    setPreviewRoleState(role);
    if (typeof window === "undefined") return;
    if (role) window.localStorage.setItem(PREVIEW_KEY, role);
    else window.localStorage.removeItem(PREVIEW_KEY);
  };

  useEffect(() => {
    let active = true;

    const loadRole = async (userId: string | undefined) => {
      if (!userId) {
        if (active) {
          setIsAdmin(false);
          setIsOwner(false);
          setIsManager(false);
        }
        return;
      }
      const [{ data: admin }, { data: owner }, { data: manager }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase.rpc("is_owner", { _user_id: userId }),
        supabase.rpc("is_org_manager", { _user_id: userId }),
      ]);
      if (!active) return;
      setIsAdmin(Boolean(admin) || Boolean(owner));
      setIsOwner(Boolean(owner));
      setIsManager(Boolean(manager));
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      void loadRole(data.session?.user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
      void loadRole(nextSession?.user.id);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null;
    const previewing = previewRole !== null && (isAdmin || isOwner);
    const effectiveAdmin = previewing ? false : isAdmin;
    const effectiveOwner = previewing ? false : isOwner;
    const meta = (user?.user_metadata ?? {}) as { display_name?: string };
    return {
      user,
      session,
      isAdmin: effectiveAdmin,
      isManager: previewing ? false : isManager,
      isOwner: effectiveOwner,
      previewRole: previewing ? previewRole : null,
      canPreviewRoles: isAdmin || isOwner,
      setPreviewRole,
      authority: effectiveOwner ? 100 : effectiveAdmin ? 90 : previewing ? 0 : isManager ? 60 : 0,
      loading,
      displayName: meta.display_name ?? user?.email?.split("@")[0] ?? "Guest",
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, isAdmin, isOwner, isManager, loading, previewRole]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
