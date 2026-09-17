import type { Geometry, Position } from "geojson";

import type { Attributes, CategoryWithFields, FeatureRow, Profile } from "./data";
import { featureAttributes, featureGeometry } from "./data";
import { geometryCentre } from "./geo";

type ExportContext = {
  categories: CategoryWithFields[];
  profiles: Profile[];
};

function categoryName(row: FeatureRow, ctx: ExportContext) {
  return ctx.categories.find((c) => c.id === row.category_id)?.name ?? "Uncategorised";
}

function contributorName(row: FeatureRow, ctx: ExportContext) {
  const profile = ctx.profiles.find((p) => p.id === row.created_by);
  return profile?.display_name ?? profile?.email ?? "Unknown";
}

function baseProperties(row: FeatureRow, ctx: ExportContext) {
  return {
    id: row.id,
    category: categoryName(row, ctx),
    status: row.status,
    contributor: contributorName(row, ctx),
    area_sqm: Number(row.area_sqm),
    length_m: Number(row.length_m),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toGeoJson(rows: FeatureRow[], ctx: ExportContext): string {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      // Explicit CRS note: everything is stored and exported in WGS84 (EPSG:4326).
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      features: rows.map((row) => ({
        type: "Feature",
        id: row.id,
        properties: { ...baseProperties(row, ctx), ...featureAttributes(row) },
        geometry: featureGeometry(row),
      })),
    },
    null,
    2,
  );
}

function coordString(positions: Position[]): string {
  return positions.map((p) => `${p[0]},${p[1]},0`).join(" ");
}

function kmlGeometry(geometry: Geometry): string {
  switch (geometry.type) {
    case "Point":
      return `<Point><coordinates>${geometry.coordinates[0]},${geometry.coordinates[1]},0</coordinates></Point>`;
    case "LineString":
      return `<LineString><tessellate>1</tessellate><coordinates>${coordString(geometry.coordinates)}</coordinates></LineString>`;
    case "Polygon":
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordString(geometry.coordinates[0] ?? [])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    default: {
      const [lng, lat] = geometryCentre(geometry);
      return `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toKml(rows: FeatureRow[], ctx: ExportContext): string {
  const placemarks = rows
    .map((row) => {
      const props: Attributes = { ...baseProperties(row, ctx), ...featureAttributes(row) };
      const data = Object.entries(props)
        .map(
          ([key, value]) =>
            `<Data name="${escapeXml(key)}"><value>${escapeXml(String(value ?? ""))}</value></Data>`,
        )
        .join("");
      return `<Placemark><name>${escapeXml(categoryName(row, ctx))}</name><ExtendedData>${data}</ExtendedData>${kmlGeometry(featureGeometry(row))}</Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>DroneTrace export</name>
${placemarks}
</Document></kml>`;
}

export function toCsv(rows: FeatureRow[], ctx: ExportContext): string {
  const attributeKeys = Array.from(
    new Set(rows.flatMap((row) => Object.keys(featureAttributes(row)))),
  ).sort();
  const header = [
    "id",
    "category",
    "status",
    "contributor",
    "area_sqm",
    "length_m",
    "centre_lng",
    "centre_lat",
    "created_at",
    ...attributeKeys,
  ];

  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = rows.map((row) => {
    const [lng, lat] = geometryCentre(featureGeometry(row));
    const attrs = featureAttributes(row);
    const base = baseProperties(row, ctx);
    return [
      base.id,
      base.category,
      base.status,
      base.contributor,
      base.area_sqm,
      base.length_m,
      lng.toFixed(6),
      lat.toFixed(6),
      base.created_at,
      ...attributeKeys.map((key) => attrs[key] ?? ""),
    ]
      .map(escape)
      .join(",");
  });

  return [header.join(","), ...lines].join("\n");
}

export function downloadText(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** WGS84 projection file shipped inside the Shapefile archive. */
const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

/**
 * Zipped Shapefile (.shp/.shx/.dbf/.prj) of the given features, in WGS84.
 * Runs in the browser so no data leaves the signed-in session.
 */
export async function downloadShapefile(rows: FeatureRow[], ctx: ExportContext, filename: string) {
  const { zip } = await import("@mapbox/shp-write");
  const collection = {
    type: "FeatureCollection" as const,
    features: rows.map((row) => ({
      type: "Feature" as const,
      properties: { ...baseProperties(row, ctx), ...featureAttributes(row) },
      geometry: featureGeometry(row),
    })),
  };
  const blob = (await zip(collection as never, {
    outputType: "blob",
    compression: "DEFLATE",
    prj: WGS84_PRJ,
    types: { point: "points", polygon: "polygons", line: "lines" },
  })) as Blob;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
