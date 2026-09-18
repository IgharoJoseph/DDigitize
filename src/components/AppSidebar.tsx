import { Link, useParams } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import {
  ClipboardList,
  Download,
  FolderKanban,
  LayoutDashboard,
  Layers,
  Map as MapIcon,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess } from "@/hooks/useProjectRole";

type Icon = ComponentType<{ className?: string }>;

/**
 * Production-tool navigation. Global entries are always shown; the project
 * block appears once you are inside a project workspace.
 */
export function AppSidebar() {
  return (
    <aside className="hidden w-48 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-panel px-2 py-3 md:flex">
      <SidebarNav />
    </aside>
  );
}

/**
 * Same navigation inside a slide-over panel, used on phones where the sidebar
 * has no room. The trigger lives in the top bar.
 */
export function MobileNavButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 md:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 bg-panel px-2 py-3">
        <SheetHeader className="px-2 pb-2">
          <SheetTitle className="text-sm">Menu</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: (() => void) | undefined }) {
  const { user, isAdmin, isManager } = useAuth();
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId ?? null;
  const access = useProjectAccess(projectId ?? "");

  if (!user) return null;

  return (
    <>
      <Section title="Workspace">
        <Item onNavigate={onNavigate} to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <Item onNavigate={onNavigate} to="/" icon={FolderKanban} label="Projects" exact />
        {(isAdmin || isManager) && (
          <Item onNavigate={onNavigate} to="/export" icon={Download} label="Exports" />
        )}
        {isAdmin && <Item onNavigate={onNavigate} to="/users" icon={Users} label="Accounts" />}
        {isAdmin && (
          <Item onNavigate={onNavigate} to="/audit" icon={ScrollText} label="Audit log" />
        )}
        <Item onNavigate={onNavigate} to="/settings" icon={Settings} label="Settings" />
      </Section>

      {projectId && access.isMember && (
        <Section title="This project">
          <ProjectItem
            onNavigate={onNavigate}
            to="/p/$projectId"
            projectId={projectId}
            icon={MapIcon}
            label="Map"
            exact
          />
          <ProjectItem
            onNavigate={onNavigate}
            to="/p/$projectId/tasks"
            projectId={projectId}
            icon={ClipboardList}
            label="Tasks"
          />
          {access.canReview && (
            <ProjectItem
              onNavigate={onNavigate}
              to="/p/$projectId/review"
              projectId={projectId}
              icon={ShieldCheck}
              label="QA / Review"
            />
          )}
          <ProjectItem
            onNavigate={onNavigate}
            to="/p/$projectId/progress"
            projectId={projectId}
            icon={LayoutDashboard}
            label="Reports"
          />
          {access.canManage && (
            <>
              <ProjectItem
                onNavigate={onNavigate}
                to="/p/$projectId/setup"
                projectId={projectId}
                icon={Layers}
                label="Layers"
              />
              <ProjectItem
                onNavigate={onNavigate}
                to="/p/$projectId/setup"
                projectId={projectId}
                icon={Users}
                label="Team"
              />
              <ProjectItem
                onNavigate={onNavigate}
                to="/p/$projectId/setup"
                projectId={projectId}
                icon={Settings}
                label="Settings"
              />
            </>
          )}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

const itemClass =
  "flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
const activeClass = "bg-secondary text-foreground";

function Item({
  to,
  icon: Icon,
  label,
  exact,
  onNavigate,
}: {
  to: "/" | "/dashboard" | "/export" | "/audit" | "/users" | "/settings";
  icon: Icon;
  label: string;
  exact?: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      activeOptions={{ exact: Boolean(exact) }}
      activeProps={{ className: activeClass }}
      className={itemClass}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}

function ProjectItem({
  to,
  projectId,
  icon: Icon,
  label,
  exact,
  onNavigate,
}: {
  to:
    | "/p/$projectId"
    | "/p/$projectId/tasks"
    | "/p/$projectId/review"
    | "/p/$projectId/progress"
    | "/p/$projectId/setup";
  projectId: string;
  icon: Icon;
  label: string;
  exact?: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      to={to}
      params={{ projectId }}
      onClick={onNavigate}
      activeOptions={{ exact: Boolean(exact) }}
      activeProps={{ className: activeClass }}
      className={itemClass}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}
