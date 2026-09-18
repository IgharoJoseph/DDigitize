import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ReviewStatus = Database["public"]["Enums"]["review_status"];
export type AreaStatus = Database["public"]["Enums"]["area_status"];

/** Feature tallies for one project, counted in the database. */
export type FeatureCounts = {
  total: number;
  draft: number;
  submitted: number;
  underReview: number;
  approved: number;
  correction: number;
};

/** Work-area tallies for one project — progress is measured on areas, not features. */
export type AreaCounts = {
  total: number;
  notStarted: number;
  inProgress: number;
  submitted: number;
  complete: number;
  percent: number;
};

export type Overview = {
  featuresByProject: Record<string, FeatureCounts>;
  areasByProject: Record<string, AreaCounts>;
  featureTotals: FeatureCounts;
  contributors: number;
};

export const ok = {
  overview: ["overview"] as const,
  audit: ["audit-log"] as const,
};

function unwrap<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

const emptyFeatureCounts = (): FeatureCounts => ({
  total: 0,
  draft: 0,
  submitted: 0,
  underReview: 0,
  approved: 0,
  correction: 0,
});

const num = (value: unknown) => Number(value ?? 0);

/**
 * Dashboard totals. The counting happens in the database (aggregate functions
 * under the same row-level security), so figures stay correct for projects with
 * far more than the API's row cap and no feature rows are shipped to the browser.
 */
export async function fetchOverview(asContributor = false): Promise<Overview> {
  const [featureRows, areaRows, contributors] = await Promise.all([
    supabase.rpc("dashboard_feature_counts", { _as_contributor: asContributor }),
    supabase.rpc("dashboard_area_counts"),
    supabase.rpc("dashboard_contributor_count"),
  ]);

  const features = unwrap(featureRows) as Record<string, unknown>[];
  const areas = unwrap(areaRows) as Record<string, unknown>[];

  const featuresByProject: Record<string, FeatureCounts> = {};
  const featureTotals = emptyFeatureCounts();
  for (const row of features) {
    const counts: FeatureCounts = {
      total: num(row["total"]),
      draft: num(row["drafts"]),
      submitted: num(row["submitted"]),
      underReview: num(row["under_review"]),
      approved: num(row["approved"]),
      correction: num(row["corrections"]),
    };
    featuresByProject[String(row["project_id"])] = counts;
    featureTotals.total += counts.total;
    featureTotals.draft += counts.draft;
    featureTotals.submitted += counts.submitted;
    featureTotals.underReview += counts.underReview;
    featureTotals.approved += counts.approved;
    featureTotals.correction += counts.correction;
  }

  const areasByProject: Record<string, AreaCounts> = {};
  for (const row of areas) {
    const total = num(row["total"]);
    const complete = num(row["complete"]);
    areasByProject[String(row["project_id"])] = {
      total,
      notStarted: num(row["not_started"]),
      inProgress: num(row["in_progress"]),
      submitted: num(row["submitted"]),
      complete,
      percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    };
  }

  return {
    featuresByProject,
    areasByProject,
    featureTotals,
    contributors: num(contributors.data),
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

export const noFeatureCounts = emptyFeatureCounts;

export const noAreaCounts = (): AreaCounts => ({
  total: 0,
  notStarted: 0,
  inProgress: 0,
  submitted: 0,
  complete: 0,
  percent: 0,
});
