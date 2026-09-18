import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { supabase } from "@/integrations/supabase/client";

type AuthState = {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  /** The single account with ultimate authority: the project owner. */
  isOwner: boolean;
  /** Authority on the shared scale: owner 100, admin 90, otherwise 0. */
  authority: number;
  loading: boolean;
  displayName: string;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadRole = async (userId: string | undefined) => {
      if (!userId) {
        if (active) {
          setIsAdmin(false);
          setIsOwner(false);
        }
        return;
      }
      const [{ data: admin }, { data: owner }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase.rpc("is_owner", { _user_id: userId }),
      ]);
      if (!active) return;
      setIsAdmin(Boolean(admin) || Boolean(owner));
      setIsOwner(Boolean(owner));
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
    const meta = (user?.user_metadata ?? {}) as { display_name?: string };
    return {
      user,
      session,
      isAdmin,
      isOwner,
      authority: isOwner ? 100 : isAdmin ? 90 : 0,
      loading,
      displayName: meta.display_name ?? user?.email?.split("@")[0] ?? "Guest",
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, isAdmin, isOwner, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
