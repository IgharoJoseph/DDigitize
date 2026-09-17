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

/**
 * Everything checked while digitising: geometry validity, work-area
 * containment, self-intersection, duplicate/overlap rules and required
 * attributes. Errors block saving; warnings only need acknowledging.
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
}): Issue[] {
  const issues: Issue[] = [];
  const { geometry, category } = input;

  if (!isValidGeometry(geometry)) {
    issues.push({ severity: "error", message: "The shape has invalid coordinates." });
    return issues;
  }

  // Work-area containment.
  if (input.restrictedToAssignments) {
    const inside = input.containingArea && input.assignedAreaIds.includes(input.containingArea.id);
    if (!inside) {
      issues.push({ severity: "error", message: "Outside assigned work area" });
    }
  } else if (category?.require_within_area && input.areas.length > 0 && !input.containingArea) {
    issues.push({
      severity: "warning",
      message: "This shape does not fall inside any work area.",
    });
  }

  // Self-intersection on lines and polygons.
  if (geometry.type === "LineString" || geometry.type === "Polygon") {
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

  // Required attributes.
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
