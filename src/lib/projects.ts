import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import type { Feature, Geometry, Polygon } from "geojson";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

import { geometryCentre, safeLngLat } from "./geo";

export type Project = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectMember = Database["public"]["Tables"]["project_members"]["Row"];
export type WorkArea = Database["public"]["Tables"]["work_areas"]["Row"];
export type AreaAssignment = Database["public"]["Tables"]["area_assignments"]["Row"];
export type ProjectRole = Database["public"]["Enums"]["project_role"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];
export type AreaStatus = Database["public"]["Enums"]["area_status"];

/** Effective role of the signed-in person for one project. */
export type EffectiveRole = "admin" | ProjectRole | "none";

/** Authority of each project role; you may only act on roles below your own. */
export const ROLE_RANK: Record<ProjectRole, number> = {
  manager: 50,
  supervisor: 30,
  contributor: 10,
};

export const PROJECT_ROLES: { value: ProjectRole; label: string; blurb: string }[] = [
  {
    value: "manager",
    label: "Manager",
    blurb: "Sets up feature layers, imagery, work areas and the team. Reviews work.",
  },
  {
    value: "supervisor",
    label: "Supervisor",
    blurb: "Reviews and verifies work, can digitize. Cannot change the setup.",
  },
  {
    value: "contributor",
    label: "Contributor",
    blurb: "Digitizes inside the work areas assigned to them.",
  },
];

export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "setup", label: "Setup" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "closed", label: "Closed" },
];

export const AREA_STATUSES: { value: AreaStatus; label: string }[] = [
  { value: "unassigned", label: "Unassigned" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "complete", label: "Complete" },
];

export const pk = {
  projects: ["projects"] as const,
  members: (projectId: string) => ["project-members", projectId] as const,
  myMemberships: ["my-memberships"] as const,
  areas: (projectId: string) => ["work-areas", projectId] as const,
  assignments: (projectId: string) => ["area-assignments", projectId] as const,
};

function unwrap<T>(result: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

function unwrapNullable<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/* ------------------------------- projects ------------------------------- */

export async function fetchProjects(): Promise<Project[]> {
  return unwrap(
    await supabase.from("projects").select("*").order("created_at", { ascending: false }),
  );
}

export async function fetchProject(projectId: string): Promise<Project | null> {
  return unwrapNullable(
    await supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
  );
}

export async function createProject(input: {
  name: string;
  description: string | null;
  createdBy: string;
}): Promise<Project> {
  const project = unwrap(
    await supabase
      .from("projects")
      .insert({ name: input.name, description: input.description, created_by: input.createdBy })
      .select("*")
      .single(),
  );
  // The creator joins as manager so they can set the project up straight away.
  await supabase.from("project_members").insert({
    project_id: project.id,
    user_id: input.createdBy,
    role: "manager",
    added_by: input.createdBy,
  });
  return project;
}

export async function updateProject(
  projectId: string,
  patch: { name?: string; description?: string | null; status?: ProjectStatus },
): Promise<Project> {
  return unwrap(
    await supabase.from("projects").update(patch).eq("id", projectId).select("*").single(),
  );
}

export async function deleteProject(projectId: string) {
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(error.message);
}

/* -------------------------------- members -------------------------------- */

export async function fetchMembers(projectId: string): Promise<ProjectMember[]> {
  return unwrap(await supabase.from("project_members").select("*").eq("project_id", projectId));
}

export async function fetchMyMemberships(): Promise<ProjectMember[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  return unwrap(await supabase.from("project_members").select("*").eq("user_id", auth.user.id));
}

export async function addMember(input: {
  projectId: string;
  userId: string;
  role: ProjectRole;
  addedBy: string;
}): Promise<ProjectMember> {
  return unwrap(
    await supabase
      .from("project_members")
      .upsert(
        {
          project_id: input.projectId,
          user_id: input.userId,
          role: input.role,
          added_by: input.addedBy,
        },
        { onConflict: "project_id,user_id" },
      )
      .select("*")
      .single(),
  );
}

/**
 * Removing a member is refused by the database when the person is at or above
 * your own authority. A refused delete returns no error and no rows, so the
 * returned rows are checked here — otherwise a blocked removal looked like it
 * had worked while the person kept their access.
 */
export async function removeMember(id: string) {
  const { data, error } = await supabase
    .from("project_members")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(
      "That person was not removed: you can only remove people below your own level, and never the platform owner.",
    );
  }
}

/* ------------------------------- work areas ------------------------------ */

export async function fetchWorkAreas(projectId: string): Promise<WorkArea[]> {
  return unwrap(
    await supabase.from("work_areas").select("*").eq("project_id", projectId).order("name"),
  );
}

export async function createWorkArea(input: {
  projectId: string;
  name: string;
  boundary: Polygon;
  notes?: string | null;
  createdBy: string;
}): Promise<WorkArea> {
  return unwrap(
    await supabase
      .from("work_areas")
      .insert({
        project_id: input.projectId,
        name: input.name,
        boundary: input.boundary as unknown as WorkArea["boundary"],
        notes: input.notes ?? null,
        created_by: input.createdBy,
      })
      .select("*")
      .single(),
  );
}

export async function updateWorkArea(
  id: string,
  patch: { name?: string; status?: AreaStatus; notes?: string | null },
): Promise<WorkArea> {
  return unwrap(await supabase.from("work_areas").update(patch).eq("id", id).select("*").single());
}

export async function deleteWorkArea(id: string) {
  const { error } = await supabase.from("work_areas").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function areaBoundary(area: WorkArea): Polygon {
  return area.boundary as unknown as Polygon;
}

/* ------------------------------ assignments ------------------------------ */

export async function fetchAssignments(projectId: string): Promise<AreaAssignment[]> {
  const areas = await fetchWorkAreas(projectId);
  if (areas.length === 0) return [];
  return unwrap(
    await supabase
      .from("area_assignments")
      .select("*")
      .in(
        "work_area_id",
        areas.map((area) => area.id),
      ),
  );
}

export async function assignArea(input: {
  workAreaId: string;
  userId: string;
  assignedBy: string;
}): Promise<AreaAssignment> {
  const row = unwrap(
    await supabase
      .from("area_assignments")
      .upsert(
        { work_area_id: input.workAreaId, user_id: input.userId, assigned_by: input.assignedBy },
        { onConflict: "work_area_id,user_id" },
      )
      .select("*")
      .single(),
  );
  await supabase.from("work_areas").update({ status: "assigned" }).eq("id", input.workAreaId);
  return row;
}

export async function unassignArea(id: string) {
  const { data, error } = await supabase
    .from("area_assignments")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("That assignment was not removed: you do not have permission to change it.");
  }
}

/* --------------------------- containment helpers -------------------------- */

/**
 * Which work area a geometry belongs to, decided on its centre point.
 * Coordinates are always WGS84 [longitude, latitude]; anything invalid returns
 * null instead of throwing.
 */
export function areaForGeometry(geometry: Geometry, areas: WorkArea[]): WorkArea | null {
  const raw = geometryCentre(geometry);
  const centre = safeLngLat(raw[0], raw[1]);
  if (!centre) return null;
  const probe = turfPoint(centre, {});
  for (const area of areas) {
    const boundary = areaBoundary(area);
    if (!boundary || boundary.type !== "Polygon") continue;
    try {
      const polygon: Feature<Polygon> = { type: "Feature", properties: {}, geometry: boundary };
      if (booleanPointInPolygon(probe, polygon)) return area;
    } catch {
      // A malformed boundary simply does not match.
    }
  }
  return null;
}

/** Rectangular grid of work areas covering a bounding box, west→east, north→south. */
export function gridAreas(
  bounds: { west: number; south: number; east: number; north: number },
  cols: number,
  rows: number,
  prefix = "Cell",
): { name: string; boundary: Polygon }[] {
  const out: { name: string; boundary: Polygon }[] = [];
  const dx = (bounds.east - bounds.west) / cols;
  const dy = (bounds.north - bounds.south) / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const west = bounds.west + col * dx;
      const east = west + dx;
      const north = bounds.north - row * dy;
      const south = north - dy;
      out.push({
        name: `${prefix} ${row + 1}-${col + 1}`,
        boundary: {
          type: "Polygon",
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      });
    }
  }
  return out;
}
