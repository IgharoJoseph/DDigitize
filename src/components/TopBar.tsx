import { Link } from "@tanstack/react-router";
import { LogOut, Moon, Radar, Sun } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";

export function TopBar() {
  const { user, isAdmin, displayName, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
      <Link to="/" className="flex items-center gap-2">
        <Radar className="size-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight">DroneTrace</span>
      </Link>

      <nav className="flex items-center gap-1">
        <Link
          to="/"
          activeOptions={{ exact: true }}
          activeProps={{ className: "bg-secondary text-foreground" }}
          className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Projects
        </Link>
        {isAdmin && (
          <Link
            to="/export"
            activeProps={{ className: "bg-secondary text-foreground" }}
            className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Export
          </Link>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {isAdmin && (
          <Badge variant="outline" className="text-[9px] uppercase">
            admin
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={toggle}
          aria-label="Toggle colour theme"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        {user ? (
          <>
            <span className="hidden text-xs text-muted-foreground sm:inline">{displayName}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => void signOut()}
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </>
        ) : (
          <Button asChild size="sm" className="h-8 text-xs">
            <Link to="/auth">Sign in</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
