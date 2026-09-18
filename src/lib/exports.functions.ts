import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Category, CategoryField, FeatureRow, Profile } from "@/lib/data";

const input = z.object({
  projectId: z.string().uuid(),
  status: z.string().trim().max(40).optional(),
});

export type ExportPayload = {
  features: FeatureRow[];
  categories: (Category & { fields: CategoryField[] })[];
  profiles: Profile[];
  projectName: string;
};

type Result<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
type Row = Record<string, unknown>;
type Chain = Result<Row[]> & {
  select: (columns: string) => Chain;
  eq: (column: string, value: unknown) => Chain;
  in: (column: string, values: unknown[]) => Chain;
  order: (column: string, options?: { ascending?: boolean }) => Chain;
  maybeSingle: () => Result<Row>;
  insert: (row: Row) => Result<null>;
};
type AuthedContext = {
  userId: string;
  supabase: {
    from: (table: string) => Chain;
    rpc: (
      fn: "has_project_permission",
      args: { _user_id: string; _project_id: string; _permission: string },
    ) => Result<boolean> & { then: PromiseLike<unknown>["then"] };
  };
};

/**
 * Server-side gate for downloads. The interface hid the export page from
 * non-admins, but the data itself was reachable through the API, so the check
 * now happens here against the database permission matrix: the caller needs the
 * 'export' permission on this project (platform administrator, organisation
 * manager or project owner), and every download is written to the audit trail.
 */
export const buildProjectExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }): Promise<ExportPayload> => {
    const { supabase, userId } = context as unknown as AuthedContext;

    const allowed = await supabase.rpc("has_project_permission", {
      _user_id: userId,
      _project_id: data.projectId,
      _permission: "export",
    });
    if (allowed.error) throw new Error(allowed.error.message);
    if (!allowed.data) throw new Error("You do not have permission to export this project.");

    const project = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", data.projectId)
      .maybeSingle();
    if (project.error) throw new Error(project.error.message);
    if (!project.data) throw new Error("Project not found.");

    let features = supabase
      .from("features")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") features = features.eq("status", data.status);
    const featureRows = await features;
    if (featureRows.error) throw new Error(featureRows.error.message);

    const categories = await supabase
      .from("feature_categories")
      .select("*")
      .eq("project_id", data.projectId)
      .order("sort_order");
    if (categories.error) throw new Error(categories.error.message);

    const categoryList = (categories.data ?? []) as unknown as Category[];
    const fields = categoryList.length
      ? await supabase
          .from("category_fields")
          .select("*")
          .in(
            "category_id",
            categoryList.map((category) => category.id),
          )
      : { data: [], error: null };
    if (fields.error) throw new Error(fields.error.message);

    const profiles = await supabase.from("profiles").select("*");
    if (profiles.error) throw new Error(profiles.error.message);

    await supabase.from("activity_log").insert({
      project_id: data.projectId,
      user_id: userId,
      action: "export.generated",
      detail: `${(featureRows.data ?? []).length} features (${data.status ?? "all"})`,
    });

    const fieldList = (fields.data ?? []) as unknown as CategoryField[];
    return {
      features: (featureRows.data ?? []) as unknown as FeatureRow[],
      categories: categoryList.map((category) => ({
        ...category,
        fields: fieldList.filter((field) => field.category_id === category.id),
      })),
      profiles: (profiles.data ?? []) as unknown as Profile[],
      projectName: String((project.data as Row)["name"] ?? "project"),
    };
  });
