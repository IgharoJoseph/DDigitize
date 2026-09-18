import { Link, useParams } from "@tanstack/react-router";
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

import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess } from "@/hooks/useProjectRole";

type Icon = ComponentType<{ className?: string }>;

/**
 * Production-tool navigation. Global entries are always shown; the project
 * block appears once you are inside a project workspace.
 */
export function AppSidebar() {
  const { user, isAdmin } = useAuth();
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId ?? null;
  const access = useProjectAccess(projectId ?? "");

  if (!user) return null;

  return (
    <aside className="hidden w-48 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-panel px-2 py-3 md:flex">
      <Section title="Workspace">
        <Item to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <Item to="/" icon={FolderKanban} label="Projects" exact />
        {isAdmin && <Item to="/export" icon={Download} label="Exports" />}
        {isAdmin && <Item to="/users" icon={Users} label="Accounts" />}
        {isAdmin && <Item to="/audit" icon={ScrollText} label="Audit log" />}
      </Section>

      {projectId && access.isMember && (
        <Section title="This project">
          <ProjectItem to="/p/$projectId" projectId={projectId} icon={MapIcon} label="Map" exact />
          <ProjectItem
            to="/p/$projectId/tasks"
            projectId={projectId}
            icon={ClipboardList}
            label="Tasks"
          />
          {access.canReview && (
            <ProjectItem
              to="/p/$projectId/review"
              projectId={projectId}
              icon={ShieldCheck}
              label="QA / Review"
            />
          )}
          <ProjectItem
            to="/p/$projectId/progress"
            projectId={projectId}
            icon={LayoutDashboard}
            label="Reports"
          />
          {access.canManage && (
            <>
              <ProjectItem
                to="/p/$projectId/setup"
                projectId={projectId}
                icon={Layers}
                label="Layers"
              />
              <ProjectItem
                to="/p/$projectId/setup"
                projectId={projectId}
                icon={Users}
                label="Team"
              />
              <ProjectItem
                to="/p/$projectId/setup"
                projectId={projectId}
                icon={Settings}
                label="Settings"
              />
            </>
          )}
        </Section>
      )}
    </aside>
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
}: {
  to: "/" | "/dashboard" | "/export" | "/audit" | "/users";
  icon: Icon;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
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
}) {
  return (
    <Link
      to={to}
      params={{ projectId }}
      activeOptions={{ exact: Boolean(exact) }}
      activeProps={{ className: activeClass }}
      className={itemClass}
    >
      <Icon className="size-3.5" />
      {label}
    </Link>
  );
}
