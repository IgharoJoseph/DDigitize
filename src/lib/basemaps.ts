import type { StyleSpecification } from "maplibre-gl";

export type BasemapId = "satellite" | "osm" | "topo" | "canvas";

export const BASEMAPS: { id: BasemapId; label: string; attribution: string }[] = [
  { id: "satellite", label: "Satellite", attribution: "Esri, Maxar, Earthstar Geographics" },
  { id: "osm", label: "OpenStreetMap", attribution: "© OpenStreetMap contributors" },
  { id: "topo", label: "Topographic", attribution: "© OpenTopoMap (CC-BY-SA)" },
  { id: "canvas", label: "Minimal canvas", attribution: "" },
];

const RASTER_SOURCES: Record<Exclude<BasemapId, "canvas">, { tiles: string[]; maxzoom: number }> = {
  satellite: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
  },
  osm: { tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], maxzoom: 19 },
  topo: { tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"], maxzoom: 17 },
};

/**
 * Basemap style. The canvas option is a flat background so drone imagery can be
 * inspected without a distracting reference layer.
 */
export function basemapStyle(id: BasemapId, isDark: boolean): StyleSpecification {
  if (id === "canvas") {
    return {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {},
      layers: [
        {
          id: "canvas-background",
          type: "background",
          paint: { "background-color": isDark ? "#141a22" : "#eef1f4" },
        },
      ],
    };
  }

  const source = RASTER_SOURCES[id];
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      basemap: {
        type: "raster",
        tiles: source.tiles,
        tileSize: 256,
        maxzoom: source.maxzoom,
        attribution: BASEMAPS.find((b) => b.id === id)?.attribution ?? "",
      },
    },
    layers: [
      {
        id: "basemap-background",
        type: "background",
        paint: { "background-color": isDark ? "#141a22" : "#eef1f4" },
      },
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-opacity": 1, "raster-brightness-max": isDark ? 0.9 : 1 },
      },
    ],
  };
}
