import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ReviewStatus = Database["public"]["Enums"]["review_status"];
export type AreaStatus = Database["public"]["Enums"]["area_status"];

export type OverviewFeature = {
  id: string;
  project_id: string | null;
  status: ReviewStatus;
  created_by: string | null;
  work_area_id: string | null;
};

export type OverviewArea = {
  id: string;
  project_id: string;
  status: AreaStatus;
  name: string;
};

export type Overview = {
  features: OverviewFeature[];
  areas: OverviewArea[];
  members: {
    project_id: string;
    user_id: string;
    role: Database["public"]["Enums"]["project_role"];
  }[];
};

export const ok = {
  overview: ["overview"] as const,
  audit: ["audit-log"] as const,
};

function unwrap<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

/** Everything the signed-in person is allowed to see, in one pass. RLS scopes it. */
export async function fetchOverview(): Promise<Overview> {
  const [features, areas, members] = await Promise.all([
    supabase.from("features").select("id, project_id, status, created_by, work_area_id"),
    supabase.from("work_areas").select("id, project_id, status, name"),
    supabase.from("project_members").select("project_id, user_id, role"),
  ]);
  return {
    features: unwrap(features) as OverviewFeature[],
    areas: unwrap(areas) as OverviewArea[],
    members: unwrap(members),
  };
}

export type AuditRow = Database["public"]["Tables"]["activity_log"]["Row"];

export async function fetchAuditLog(limit = 200): Promise<AuditRow[]> {
  return unwrap(
    await supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit),
  );
}

export function countByStatus(features: OverviewFeature[]) {
  return {
    draft: features.filter((f) => f.status === "draft").length,
    submitted: features.filter((f) => f.status === "submitted").length,
    underReview: features.filter((f) => f.status === "under_review").length,
    approved: features.filter((f) => f.status === "verified").length,
    correction: features.filter((f) => f.status === "needs_revision").length,
    total: features.length,
  };
}

/** Progress is measured on work-area completion, not on raw feature counts. */
export function areaProgress(areas: OverviewArea[]) {
  const done = areas.filter((a) => a.status === "complete").length;
  return {
    total: areas.length,
    notStarted: areas.filter((a) => a.status === "unassigned" || a.status === "assigned").length,
    inProgress: areas.filter((a) => a.status === "in_progress").length,
    submitted: areas.filter((a) => a.status === "submitted").length,
    complete: done,
    percent: areas.length === 0 ? 0 : Math.round((done / areas.length) * 100),
  };
}
