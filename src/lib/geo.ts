import area from "@turf/area";
import length from "@turf/length";
import type { Feature, Geometry, Position } from "geojson";

/** Decimal degrees, rounded for a coordinate readout. */
export function formatDecimalDegrees(lng: number, lat: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function dms(value: number, positive: string, negative: string): string {
  const hemisphere = value >= 0 ? positive : negative;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}° ${String(min).padStart(2, "0")}' ${sec.toFixed(2).padStart(5, "0")}" ${hemisphere}`;
}

export function formatDms(lng: number, lat: number): string {
  return `${dms(lat, "N", "S")}  ${dms(lng, "E", "W")}`;
}

export function utmZoneNumber(lng: number): number {
  return Math.floor(((lng + 180) % 360) / 6) + 1;
}

export function utmLatitudeBand(lat: number): string {
  const bands = "CDEFGHJKLMNPQRSTUVWX";
  if (lat < -80 || lat > 84) return "Z";
  const index = Math.floor((lat + 80) / 8);
  return bands[Math.min(index, bands.length - 1)] ?? "Z";
}

/**
 * WGS84 -> UTM forward transform (Transverse Mercator, WGS84 ellipsoid).
 * Storage always stays in EPSG:4326; this is a display-only projection.
 */
export function toUtm(lng: number, lat: number) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);

  const zone = utmZoneNumber(lng);
  const band = utmLatitudeBand(lat);
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const phi = lat * (Math.PI / 180);
  const lambda = lng * (Math.PI / 180);

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = (lambda - lambda0) * Math.cos(phi);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));

  if (lat < 0) northing += 10000000;

  return { zone, band, easting, northing, hemisphere: lat >= 0 ? "N" : "S" };
}

export function formatUtm(lng: number, lat: number): string {
  const { zone, band, easting, northing } = toUtm(lng, lat);
  return `${zone}${band} ${Math.round(easting)}E ${Math.round(northing)}N`;
}

/** Ground distance of one screen pixel, used for the metric scale bar. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

export function niceScale(maxMetres: number): { metres: number; label: string } {
  const steps = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000,
    500000, 1000000,
  ];
  const metres = steps.reverse().find((step) => step <= maxMetres) ?? 1;
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  return { metres, label };
}

function asFeature(geometry: Geometry): Feature {
  return { type: "Feature", properties: {}, geometry };
}

/** Planimetric area in m² (0 for non-polygons). */
export function geometryArea(geometry: Geometry): number {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return 0;
  return area(asFeature(geometry));
}

/** Line length in metres (0 for non-lines). */
export function geometryLength(geometry: Geometry): number {
  if (geometry.type !== "LineString" && geometry.type !== "MultiLineString") return 0;
  return length(asFeature(geometry), { units: "kilometers" }) * 1000;
}

export function formatArea(sqm: number): string {
  if (sqm >= 10000) return `${(sqm / 10000).toFixed(2)} ha`;
  return `${sqm.toFixed(1)} m²`;
}

export function formatLength(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${metres.toFixed(1)} m`;
}

/** Rough centroid of any geometry, for zooming to a feature. */
export function geometryCentre(geometry: Geometry): [number, number] {
  const coords: Position[] = [];
  const walk = (input: unknown) => {
    if (!Array.isArray(input)) return;
    if (typeof input[0] === "number" && typeof input[1] === "number") {
      coords.push(input as Position);
      return;
    }
    input.forEach(walk);
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  if (coords.length === 0) return [0, 0];
  const sum = coords.reduce<[number, number]>(
    (acc, c) => [acc[0] + (c[0] ?? 0), acc[1] + (c[1] ?? 0)],
    [0, 0],
  );
  return [sum[0] / coords.length, sum[1] / coords.length];
}

export function geometryBounds(geometry: Geometry): [number, number, number, number] | null {
  const coords: Position[] = [];
  const walk = (input: unknown) => {
    if (!Array.isArray(input)) return;
    if (typeof input[0] === "number" && typeof input[1] === "number") {
      coords.push(input as Position);
      return;
    }
    input.forEach(walk);
  };
  walk((geometry as { coordinates?: unknown }).coordinates);
  if (coords.length === 0) return null;
  return coords.reduce<[number, number, number, number]>(
    (acc, c) => [
      Math.min(acc[0], c[0] ?? 0),
      Math.min(acc[1], c[1] ?? 0),
      Math.max(acc[2], c[0] ?? 0),
      Math.max(acc[3], c[1] ?? 0),
    ],
    [180, 90, -180, -90],
  );
}

/* ------------------------------------------------------------------ *
 * Coordinate validation
 *
 * Everything in this app is stored as GeoJSON WGS84 in [longitude, latitude]
 * order. These helpers are the single place that decides whether a coordinate
 * pair is usable, so no view, converter or save path can invert or overflow it.
 * ------------------------------------------------------------------ */

/** Fallback view used whenever a centre coordinate is missing or invalid. */
export const DEFAULT_CENTER: [number, number] = [0, 0];
export const DEFAULT_ZOOM = 2;

export function isValidLng(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function clampLat(value: number): number {
  return Math.min(90, Math.max(-90, value));
}

/** Wraps longitude into [-180, 180] instead of rejecting 181 or -190. */
export function wrapLng(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let lng = ((((value + 180) % 360) + 360) % 360) - 180;
  if (lng === -180) lng = 180;
  return lng;
}

/**
 * Accepts anything and returns a valid [lng, lat] pair or null.
 * Never throws; never silently swaps the axes.
 */
export function safeLngLat(lng: unknown, lat: unknown): [number, number] | null {
  const lngNum = typeof lng === "string" ? Number(lng) : lng;
  const latNum = typeof lat === "string" ? Number(lat) : lat;
  if (typeof lngNum !== "number" || typeof latNum !== "number") return null;
  if (!Number.isFinite(lngNum) || !Number.isFinite(latNum)) return null;
  if (!isValidLat(latNum)) return null;
  const wrapped = wrapLng(lngNum);
  if (!isValidLng(wrapped)) return null;
  return [wrapped, latNum];
}

/** Same as safeLngLat but always returns a usable pair. */
export function lngLatOrDefault(
  lng: unknown,
  lat: unknown,
  fallback: [number, number] = DEFAULT_CENTER,
): [number, number] {
  return safeLngLat(lng, lat) ?? fallback;
}

export type BoundsLike = {
  west?: unknown;
  south?: unknown;
  east?: unknown;
  north?: unknown;
};

/**
 * Validates a stored bounds value; returns null when unusable.
 * Accepts both the object form and the GeoJSON/PMTiles array form
 * [west, south, east, north].
 */
export function safeBounds(
  input: unknown,
): { west: number; south: number; east: number; north: number } | null {
  if (!input) return null;
  if (Array.isArray(input)) {
    if (input.length < 4) return null;
    const sw = safeLngLat(input[0], input[1]);
    const ne = safeLngLat(input[2], input[3]);
    if (!sw || !ne || sw[1] > ne[1]) return null;
    return { west: sw[0], south: sw[1], east: ne[0], north: ne[1] };
  }
  if (typeof input !== "object") return null;
  const { west, south, east, north } = input as BoundsLike;
  const sw = safeLngLat(west, south);
  const ne = safeLngLat(east, north);
  if (!sw || !ne) return null;
  if (sw[1] > ne[1]) return null;
  return { west: sw[0], south: sw[1], east: ne[0], north: ne[1] };
}


/**
 * Parses free text a person typed into a coordinate box. Longitude first is the
 * GeoJSON convention, but people paste "lat, lng" from Google Maps, so the order
 * is explicit in the argument rather than guessed.
 */
export function parseCoordinateInput(
  text: string,
  order: "lng,lat" | "lat,lng" = "lng,lat",
): [number, number] | null {
  const parts = text
    .split(/[,\s;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [first, second] = parts as [number, number];
  return order === "lng,lat" ? safeLngLat(first, second) : safeLngLat(second, first);
}

/** True only when every coordinate in the geometry is a valid [lng, lat] pair. */
export function isValidGeometry(geometry: unknown): boolean {
  if (!geometry || typeof geometry !== "object") return false;
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  if (coordinates === undefined) return false;

  let valid = true;
  let found = false;
  const walk = (input: unknown) => {
    if (!valid || !Array.isArray(input)) return;
    if (typeof input[0] === "number" && typeof input[1] === "number") {
      found = true;
      if (!safeLngLat(input[0], input[1])) valid = false;
      return;
    }
    input.forEach(walk);
  };
  walk(coordinates);
  return valid && found;
}
