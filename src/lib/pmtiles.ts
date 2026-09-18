import { addProtocol, setWorkerUrl } from "maplibre-gl";
// MapLibre derives its worker URL from its own module URL, which breaks once the
// bundler rewrites that path (dev pre-bundling, production chunks). Without a
// worker, GeoJSON sources never tile, so digitized shapes and work areas stay
// invisible while raster imagery still draws.
//
// "?worker&url" makes the bundler compile the worker WITH its dependencies and
// hand back the URL of that bundle. Plain "?url" only copies the single file,
// whose relative import of maplibre-gl-shared.mjs then 404s and kills the
// worker again — which is exactly why shapes sometimes did not appear.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import { PMTiles, Protocol } from "pmtiles";

import { safeBounds, safeLngLat } from "./geo";

let registered = false;

/** Register the pmtiles:// protocol with MapLibre exactly once per page. */
export function ensurePmtilesProtocol() {
  if (registered || typeof window === "undefined") return;
  setWorkerUrl(maplibreWorkerUrl);
  const protocol = new Protocol({ metadata: true });
  addProtocol("pmtiles", protocol.tile);
  registered = true;
}

export type InspectResult = {
  ok: boolean;
  message: string;
  tileType?: string;
  minZoom?: number;
  maxZoom?: number;
  bounds?: { west: number; south: number; east: number; north: number } | undefined;
  center?: { lng: number; lat: number; zoom: number } | undefined;
  tileCount?: number;
  byteRangeMs?: number;
  metadata?: Record<string, unknown>;
};

const TILE_TYPES: Record<number, string> = {
  0: "unknown",
  1: "mvt (vector)",
  2: "png (raster)",
  3: "jpeg (raster)",
  4: "webp (raster)",
  5: "avif (raster)",
};

/**
 * Reads the PMTiles header + a real tile byte-range so an admin can confirm the
 * archive is publicly servable before publishing it to contributors.
 */
export async function inspectPmtiles(url: string): Promise<InspectResult> {
  try {
    const archive = new PMTiles(url);
    const header = await archive.getHeader();
    const metadata = (await archive.getMetadata()) as Record<string, unknown>;

    const started = performance.now();
    let tileFound = false;
    try {
      const z = header.minZoom;
      const centerTileX = Math.floor(((header.centerLon + 180) / 360) * Math.pow(2, z));
      const latRad = (header.centerLat * Math.PI) / 180;
      const centerTileY = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z),
      );
      const tile = await archive.getZxy(z, centerTileX, centerTileY);
      tileFound = Boolean(tile?.data);
    } catch {
      tileFound = false;
    }
    const byteRangeMs = Math.round(performance.now() - started);

    return {
      ok: true,
      message: tileFound
        ? "Header read and a tile byte-range returned data — archive is servable."
        : "Header read successfully, but no tile came back at the centre of the minimum zoom. Ranged requests work; the archive may simply be sparse there.",
      tileType: TILE_TYPES[header.tileType] ?? `code ${header.tileType}`,
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      // Archives in the wild carry junk or swapped extents, so every coordinate
      // read out of the header is validated as [lng, lat] before it is trusted.
      bounds:
        safeBounds({
          west: header.minLon,
          south: header.minLat,
          east: header.maxLon,
          north: header.maxLat,
        }) ?? undefined,
      center: (() => {
        const centre = safeLngLat(header.centerLon, header.centerLat);
        if (!centre) return undefined;
        return { lng: centre[0], lat: centre[1], zoom: header.centerZoom };
      })(),
      tileCount: header.numTileEntries,
      byteRangeMs,
      metadata,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Could not read this archive: ${detail}. Check that the URL is public, supports HTTP range requests and allows cross-origin reads (CORS).`,
    };
  }
}
