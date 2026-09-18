import type { Geometry } from "geojson";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Category = Database["public"]["Tables"]["feature_categories"]["Row"];
export type CategoryField = Database["public"]["Tables"]["category_fields"]["Row"];
export type ImageryDataset = Database["public"]["Tables"]["imagery_datasets"]["Row"];
export type FeatureRow = Database["public"]["Tables"]["features"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ActivityRow = Database["public"]["Tables"]["activity_log"]["Row"];
export type FeatureVersionRow = Database["public"]["Tables"]["feature_versions"]["Row"];
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
  removedFeatures: (projectId: string) => ["removed-features", projectId] as const,
  featureVersions: (featureId: string) => ["feature-versions", featureId] as const,
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

export type FeatureBounds = { west: number; south: number; east: number; north: number };

/**
 * Features for one project. The Data API caps a single response at 1000 rows,
 * which silently truncated large projects, so the rows are read page by page
 * (indexed on project_id, created_at) until the project is fully loaded.
 *
 * On large projects the map passes the current viewport, and only features whose
 * stored bounding box intersects it are read (indexed on
 * project_id + bbox columns).
 */
export async function fetchFeatures(
  projectId: string,
  bounds?: FeatureBounds | null,
): Promise<FeatureRow[]> {
  const rows: FeatureRow[] = [];
  for (let page = 0; ; page += 1) {
    let query = supabase
      .from("features")
      .select("*")
      .eq("project_id", projectId)
      // Removed work stays in the database for the record, but off the map.
      .is("deleted_at", null);
    if (bounds) {
      query = query
        .lte("bbox_min_lng", bounds.east)
        .gte("bbox_max_lng", bounds.west)
        .lte("bbox_min_lat", bounds.north)
        .gte("bbox_max_lat", bounds.south);
    }
    const batch = unwrap(
      await query
        .order("created_at", { ascending: false })
        .range(page * FEATURE_PAGE, page * FEATURE_PAGE + FEATURE_PAGE - 1),
    );
    rows.push(...batch);
    if (batch.length < FEATURE_PAGE) return rows;
  }
}

/** Row count only, so the map can decide whether to load by viewport. */
export async function fetchFeatureCount(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from("features")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Work that was removed but kept on record, newest first. */
export async function fetchRemovedFeatures(projectId: string): Promise<FeatureRow[]> {
  return unwrap(
    await supabase
      .from("features")
      .select("*")
      .eq("project_id", projectId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(200),
  );
}

/** Saved history for one feature, newest first. */
export async function fetchFeatureVersions(featureId: string): Promise<FeatureVersionRow[]> {
  return unwrap(
    await supabase
      .from("feature_versions")
      .select("*")
      .eq("feature_id", featureId)
      .order("created_at", { ascending: false })
      .limit(50),
  );
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

/**
 * Mark work as removed while keeping it on record. The database stamps who
 * removed it and when, and refuses a removal without a reason.
 */
export async function removeFeature(id: string, reason: string): Promise<FeatureRow> {
  return saveFeature(
    await supabase
      .from("features")
      .update({ deleted_at: new Date().toISOString(), deletion_reason: reason })
      .eq("id", id)
      .select("*")
      .single(),
  );
}

/** Bring removed work back. The database allows this for managers only. */
export async function restoreFeature(id: string): Promise<FeatureRow> {
  return saveFeature(
    await supabase
      .from("features")
      .update({ deleted_at: null, deletion_reason: null })
      .eq("id", id)
      .select("*")
      .single(),
  );
}

/** Permanent removal. The database allows this for project managers only. */
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

/* --------------------------- layer configuration -------------------------- */

export type LayerDisplay = {
  /** Fill opacity for polygons, 0–1. */
  fillOpacity: number;
  /** Outline / line width in pixels. */
  lineWidth: number;
  /** Attribute key drawn as a label, when set. */
  labelField: string | null;
  /** Zoom at which the layer starts drawing. */
  minZoom: number;
};

const DEFAULT_DISPLAY: LayerDisplay = {
  fillOpacity: 0.22,
  lineWidth: 1.5,
  labelField: null,
  minZoom: 0,
};

/** Reads a layer's display settings, falling back to the platform defaults. */
export function layerDisplay(category: Category | null | undefined): LayerDisplay {
  const raw = (category?.display_config ?? {}) as Record<string, unknown>;
  const num = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(raw[key]);
    return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
  };
  const label = raw["labelField"];
  return {
    fillOpacity: num("fillOpacity", DEFAULT_DISPLAY.fillOpacity, 0, 1),
    lineWidth: num("lineWidth", DEFAULT_DISPLAY.lineWidth, 0.5, 8),
    labelField: typeof label === "string" && label !== "" ? label : null,
    minZoom: num("minZoom", DEFAULT_DISPLAY.minZoom, 0, 22),
  };
}

/** Default values configured on a layer's attribute fields. */
export function defaultAttributes(category: CategoryWithFields | null): Attributes {
  const out: Attributes = {};
  for (const field of category?.fields ?? []) {
    const raw = field.default_value;
    if (raw === null || raw === undefined || raw === "") continue;
    if (field.field_type === "number") {
      const value = Number(raw);
      if (Number.isFinite(value)) out[field.key] = value;
    } else if (field.field_type === "boolean") {
      out[field.key] = raw === "true";
    } else {
      out[field.key] = raw;
    }
  }
  return out;
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
