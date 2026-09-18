import type { Geometry } from "geojson";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Category = Database["public"]["Tables"]["feature_categories"]["Row"];
export type CategoryField = Database["public"]["Tables"]["category_fields"]["Row"];
export type ImageryDataset = Database["public"]["Tables"]["imagery_datasets"]["Row"];
export type FeatureRow = Database["public"]["Tables"]["features"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ActivityRow = Database["public"]["Tables"]["activity_log"]["Row"];
export type ReviewStatus = Database["public"]["Enums"]["review_status"];
export type GeomType = Database["public"]["Enums"]["geom_type"];
export type FieldType = Database["public"]["Enums"]["field_type"];

export type CategoryWithFields = Category & { fields: CategoryField[] };
export type Attributes = Record<string, string | number | boolean | null>;

export const REVIEW_STATUSES: { value: ReviewStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under review" },
  { value: "verified", label: "Approved" },
  { value: "needs_revision", label: "Correction required" },
];

export function reviewStatusLabel(status: ReviewStatus): string {
  return REVIEW_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}

export const qk = {
  categories: (projectId: string) => ["categories", projectId] as const,
  datasets: (projectId: string) => ["datasets", projectId] as const,
  features: (projectId: string) => ["features", projectId] as const,
  activity: (projectId: string) => ["activity", projectId] as const,
  comments: (featureId: string) => ["feature-comments", featureId] as const,
  profiles: ["profiles"] as const,
  roles: ["roles"] as const,
};

function unwrap<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

export async function fetchCategories(projectId: string): Promise<CategoryWithFields[]> {
  const categories = unwrap(
    await supabase
      .from("feature_categories")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order"),
  );
  if (categories.length === 0) return [];
  const fields = unwrap(
    await supabase
      .from("category_fields")
      .select("*")
      .in(
        "category_id",
        categories.map((category) => category.id),
      )
      .order("sort_order"),
  );
  return categories.map((category) => ({
    ...category,
    fields: fields.filter((field) => field.category_id === category.id),
  }));
}

export async function fetchDatasets(projectId: string): Promise<ImageryDataset[]> {
  return unwrap(
    await supabase
      .from("imagery_datasets")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  );
}

const FEATURE_PAGE = 1000;

/**
 * Features for one project. The Data API caps a single response at 1000 rows,
 * which silently truncated large projects, so the rows are read page by page
 * (indexed on project_id, created_at) until the project is fully loaded.
 */
export async function fetchFeatures(projectId: string): Promise<FeatureRow[]> {
  const rows: FeatureRow[] = [];
  for (let page = 0; ; page += 1) {
    const batch = unwrap(
      await supabase
        .from("features")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .range(page * FEATURE_PAGE, page * FEATURE_PAGE + FEATURE_PAGE - 1),
    );
    rows.push(...batch);
    if (batch.length < FEATURE_PAGE) return rows;
  }
}

export async function fetchProfiles(): Promise<Profile[]> {
  return unwrap(await supabase.from("profiles").select("*"));
}

/** Which accounts are the owner and which hold full admin access. */
export async function fetchAccountLevels(): Promise<{
  ownerIds: string[];
  adminIds: string[];
  managerIds: string[];
}> {
  const [owners, admins, managers] = await Promise.all([
    supabase.from("app_owners").select("user_id"),
    supabase.from("user_roles").select("user_id").eq("role", "admin"),
    supabase.from("user_roles").select("user_id").eq("role", "manager"),
  ]);
  return {
    ownerIds: (owners.data ?? []).map((row) => row.user_id),
    adminIds: (admins.data ?? []).map((row) => row.user_id),
    managerIds: (managers.data ?? []).map((row) => row.user_id),
  };
}

export async function fetchActivity(projectId: string, limit = 40): Promise<ActivityRow[]> {
  return unwrap(
    await supabase
      .from("activity_log")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
}

export async function logActivity(
  projectId: string,
  action: string,
  detail: string,
  featureId?: string,
) {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("activity_log").insert({
    project_id: projectId,
    user_id: data.user.id,
    feature_id: featureId ?? null,
    action,
    detail,
  });
}

export type NewFeature = {
  projectId: string;
  workAreaId: string | null;
  categoryId: string | null;
  datasetId: string | null;
  geometry: Geometry;
  attributes: Attributes;
  areaSqm: number;
  lengthM: number;
  createdBy: string;
};

type FeatureInsert = Database["public"]["Tables"]["features"]["Insert"];
type FeatureUpdate = Database["public"]["Tables"]["features"]["Update"];
type Json = FeatureInsert["geometry"];

/**
 * The database refuses shapes that fall outside the person's assigned work
 * area. That refusal is turned into plain wording here.
 */
function saveFeature<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error?.message.includes("Outside assigned work area")) {
    throw new Error("That shape falls outside your assigned work area, so it was not saved.");
  }
  return unwrap(result);
}

export async function createFeature(input: NewFeature): Promise<FeatureRow> {
  const payload: FeatureInsert = {
    project_id: input.projectId,
    work_area_id: input.workAreaId,
    category_id: input.categoryId,
    dataset_id: input.datasetId,
    geometry: input.geometry as unknown as Json,
    attributes: input.attributes as unknown as Json,
    area_sqm: input.areaSqm,
    length_m: input.lengthM,
    created_by: input.createdBy,
  };
  return saveFeature(await supabase.from("features").insert(payload).select("*").single());
}

export type FeaturePatch = {
  geometry?: Geometry;
  attributes?: Attributes;
  areaSqm?: number;
  lengthM?: number;
  status?: ReviewStatus;
  categoryId?: string | null;
  workAreaId?: string | null;
  reviewNote?: string | null;
};

export async function updateFeature(id: string, patch: FeaturePatch): Promise<FeatureRow> {
  const payload: FeatureUpdate = {};
  if (patch.geometry) payload["geometry"] = patch.geometry as unknown as Json;
  if (patch.attributes) payload["attributes"] = patch.attributes as unknown as Json;
  if (patch.areaSqm !== undefined) payload["area_sqm"] = patch.areaSqm;
  if (patch.lengthM !== undefined) payload["length_m"] = patch.lengthM;
  if (patch.status) payload["status"] = patch.status;
  if (patch.categoryId !== undefined) payload["category_id"] = patch.categoryId;
  if (patch.workAreaId !== undefined) payload["work_area_id"] = patch.workAreaId;
  if (patch.reviewNote !== undefined) payload["review_note"] = patch.reviewNote;
  return saveFeature(
    await supabase.from("features").update(payload).eq("id", id).select("*").single(),
  );
}

export async function deleteFeature(id: string) {
  const { error } = await supabase.from("features").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function featureGeometry(row: FeatureRow): Geometry {
  return row.geometry as unknown as Geometry;
}

export function featureAttributes(row: FeatureRow): Attributes {
  return (row.attributes ?? {}) as Attributes;
}

/* ------------------------------- QA comments ------------------------------ */

export type FeatureComment = Database["public"]["Tables"]["feature_comments"]["Row"];

export async function fetchComments(featureId: string): Promise<FeatureComment[]> {
  return unwrap(
    await supabase
      .from("feature_comments")
      .select("*")
      .eq("feature_id", featureId)
      .order("created_at", { ascending: true }),
  );
}

export async function addComment(input: {
  projectId: string;
  featureId: string;
  authorId: string;
  body: string;
}): Promise<FeatureComment> {
  return unwrap(
    await supabase
      .from("feature_comments")
      .insert({
        project_id: input.projectId,
        feature_id: input.featureId,
        author_id: input.authorId,
        body: input.body,
      })
      .select("*")
      .single(),
  );
}

export async function resolveComment(id: string, resolved: boolean) {
  const { error } = await supabase.from("feature_comments").update({ resolved }).eq("id", id);
  if (error) throw new Error(error.message);
}
