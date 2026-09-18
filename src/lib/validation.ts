import area from "@turf/area";
import booleanIntersects from "@turf/boolean-intersects";
import intersect from "@turf/intersect";
import kinks from "@turf/kinks";
import type { Feature, Geometry, Polygon } from "geojson";

import { isValidGeometry } from "./geo";
import { areaBoundary, type WorkArea } from "./projects";
import type { Category, CategoryField, FeatureRow } from "./data";
import { featureAttributes, featureGeometry } from "./data";

export type Issue = { severity: "error" | "warning"; message: string; featureId?: string };

function asFeature(geometry: Geometry): Feature {
  return { type: "Feature", properties: {}, geometry };
}

/** Fraction of `geometry` covered by `other`; 0 when they do not overlap. */
function overlapRatio(geometry: Geometry, other: Geometry): number {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    try {
      return booleanIntersects(asFeature(geometry), asFeature(other)) ? 1 : 0;
    } catch {
      return 0;
    }
  }
  if (other.type !== "Polygon" && other.type !== "MultiPolygon") return 0;
  try {
    const shared = intersect({
      type: "FeatureCollection",
      features: [asFeature(geometry) as Feature<Polygon>, asFeature(other) as Feature<Polygon>],
    });
    if (!shared) return 0;
    const total = area(asFeature(geometry));
    if (total <= 0) return 0;
    return area(shared) / total;
  } catch {
    return 0;
  }
}

const GEOMETRY_KINDS: Record<string, string[]> = {
  polygon: ["Polygon", "MultiPolygon"],
  line: ["LineString", "MultiLineString"],
  point: ["Point", "MultiPoint"],
};

/** Every coordinate pair in a geometry, whatever its nesting depth. */
function coordinatePairs(geometry: Geometry): number[][] {
  const out: number[][] = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      out.push(node as number[]);
      return;
    }
    for (const child of node) walk(child);
  };
  if ("coordinates" in geometry) walk((geometry as { coordinates: unknown }).coordinates);
  return out;
}

/**
 * Everything checked while digitising: geometry validity, work-area
 * containment, self-intersection, duplicate/overlap rules and required
 * attributes. Errors block saving; warnings only need acknowledging.
 * The same rules are enforced again by the database, so a bypassed browser
 * check cannot store bad data.
 */
export function validateFeature(input: {
  geometry: Geometry;
  category: (Category & { fields: CategoryField[] }) | null;
  attributes?: Record<string, unknown>;
  areas: WorkArea[];
  assignedAreaIds: string[];
  restrictedToAssignments: boolean;
  containingArea: WorkArea | null;
  siblings: FeatureRow[];
  featureId?: string;
  /** Project boundary, when the project has one. */
  projectBoundary?: Geometry | null;
}): Issue[] {
  const issues: Issue[] = [];
  const { geometry, category } = input;

  if (!isValidGeometry(geometry)) {
    issues.push({ severity: "error", message: "The shape has invalid coordinates." });
    return issues;
  }

  const pairs = coordinatePairs(geometry);
  if (pairs.length === 0) {
    issues.push({ severity: "error", message: "The shape is empty." });
    return issues;
  }
  // CRS: storage is always EPSG:4326, so anything outside the WGS84 range is
  // a projected coordinate that must not be saved.
  const outOfRange = pairs.some(
    (pair) =>
      !Number.isFinite(pair[0]) ||
      !Number.isFinite(pair[1]) ||
      Math.abs(pair[0] as number) > 180 ||
      Math.abs(pair[1] as number) > 90,
  );
  if (outOfRange) {
    issues.push({
      severity: "error",
      message:
        "The coordinates are not longitude/latitude values (WGS84), so the shape was not saved.",
    });
    return issues;
  }

  if (category) {
    const allowed = GEOMETRY_KINDS[category.geometry_type] ?? [];
    if (!allowed.includes(geometry.type)) {
      issues.push({
        severity: "error",
        message: `${category.name} holds ${category.geometry_type} shapes, so this shape cannot be saved to it.`,
      });
      return issues;
    }
    const maxVertices = Math.max(category.max_vertices ?? 10000, 3);
    if (pairs.length > maxVertices) {
      issues.push({
        severity: "error",
        message: `The shape has ${pairs.length} points; this layer allows ${maxVertices}. Simplify it before saving.`,
      });
    }
    const kb = Math.round(JSON.stringify(geometry).length / 1024);
    const maxKb = Math.max(category.max_payload_kb ?? 512, 8);
    if (kb > maxKb) {
      issues.push({
        severity: "error",
        message: `The shape is too large to store (${kb} KB of ${maxKb} KB allowed).`,
      });
    }
  }

  // Project boundary.
  if (input.projectBoundary && category?.require_within_project !== false) {
    try {
      const inside = booleanIntersects(asFeature(geometry), asFeature(input.projectBoundary));
      if (!inside) {
        issues.push({
          severity: "error",
          message: "The shape falls outside the project boundary.",
        });
      }
    } catch {
      /* boundaries turf cannot compare are left to the database check */
    }
  }

  // Work-area containment.
  if (input.restrictedToAssignments) {
    const inside = input.containingArea && input.assignedAreaIds.includes(input.containingArea.id);
    if (!inside) {
      // Saying "outside your area" is confusing when no area exists or none is
      // yours yet, so the reason is spelled out instead.
      const message =
        input.areas.length === 0
          ? "This project has no work areas yet. A manager needs to create one and assign it to you before you can digitize."
          : input.assignedAreaIds.length === 0
            ? "No work area is assigned to you yet. Ask a manager or supervisor to assign one."
            : "Outside assigned work area";
      issues.push({ severity: "error", message });
    }
  } else if (category?.require_within_area && input.areas.length > 0 && !input.containingArea) {
    issues.push({
      severity: "warning",
      message: "This shape does not fall inside any work area.",
    });
  }

  // Self-intersection on lines and polygons.
  if (
    category?.forbid_self_intersection !== false &&
    (geometry.type === "LineString" || geometry.type === "Polygon")
  ) {
    try {
      if (kinks(asFeature(geometry) as never).features.length > 0) {
        issues.push({ severity: "error", message: "The shape crosses itself." });
      }
    } catch {
      /* geometry types turf cannot check are skipped */
    }
  }

  // Duplicate / overlap detection against the same layer.
  if (category?.check_duplicates || category?.allow_overlap === false) {
    for (const row of input.siblings) {
      if (row.id === input.featureId) continue;
      if (row.category_id !== category.id) continue;
      const ratio = overlapRatio(geometry, featureGeometry(row));
      if (ratio <= 0) continue;
      if (ratio > 0.4 && category.check_duplicates) {
        issues.push({
          severity: category.overlap_severity === "error" ? "error" : "warning",
          message: "Possible duplicate feature detected.",
          featureId: row.id,
        });
      } else if (!category.allow_overlap && ratio > 0.01) {
        issues.push({
          severity: category.overlap_severity === "error" ? "error" : "warning",
          message: `${category.name} features must not overlap.`,
          featureId: row.id,
        });
      }
    }
  }

  // Required attributes and attribute domains.
  const attributes = input.attributes ?? {};
  const missing = (category?.fields ?? []).filter((field) => {
    if (!field.required) return false;
    const value = attributes[field.key];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    issues.push({
      severity: "warning",
      message: `Fill in: ${missing.map((field) => field.label).join(", ")}`,
    });
  }
  for (const field of category?.fields ?? []) {
    const raw = attributes[field.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const text = String(raw);
    if (
      field.field_type === "select" &&
      field.options.length > 0 &&
      !field.options.includes(text)
    ) {
      issues.push({
        severity: "error",
        message: `${field.label} must be one of: ${field.options.join(", ")}`,
      });
      continue;
    }
    if (field.field_type === "number") {
      const value = Number(text);
      if (!Number.isFinite(value)) {
        issues.push({ severity: "error", message: `${field.label} must be a number.` });
        continue;
      }
      if (field.min_value !== null && value < Number(field.min_value)) {
        issues.push({
          severity: "error",
          message: `${field.label} must be at least ${field.min_value}.`,
        });
      }
      if (field.max_value !== null && value > Number(field.max_value)) {
        issues.push({
          severity: "error",
          message: `${field.label} must be at most ${field.max_value}.`,
        });
      }
    }
    if (field.max_length !== null && text.length > field.max_length) {
      issues.push({
        severity: "error",
        message: `${field.label} may hold at most ${field.max_length} characters.`,
      });
    }
    if (field.pattern) {
      try {
        if (!new RegExp(field.pattern).test(text)) {
          issues.push({
            severity: "error",
            message: `${field.label} is not in the expected format.`,
          });
        }
      } catch {
        /* an unusable pattern is left to the database check */
      }
    }
  }

  return issues;
}

/** Errors block submission for review. */
export function blockingIssues(issues: Issue[]) {
  return issues.filter((issue) => issue.severity === "error");
}

export function requiredAttributesMissing(
  category: (Category & { fields: CategoryField[] }) | null,
  row: FeatureRow,
): CategoryField[] {
  const attributes = featureAttributes(row);
  return (category?.fields ?? []).filter((field) => {
    if (!field.required) return false;
    const value = attributes[field.key];
    return value === undefined || value === null || value === "";
  });
}
