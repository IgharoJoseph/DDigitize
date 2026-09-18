import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Map as MapLibreMap, NavigationControl, type LngLatBoundsLike } from "maplibre-gl";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, Geometry } from "geojson";

import { AttributePanel } from "./AttributePanel";
import { BasemapPanel } from "./BasemapPanel";
import { LayersPanel } from "./LayersPanel";
import { StatusBar } from "./StatusBar";
import { ToolRail } from "./ToolRail";
import type { SaveStatus, Tool } from "./types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAccess, useProjectAreas } from "@/hooks/useProjectRole";
import { areaBoundary, areaForGeometry, fetchProject, pk, type WorkArea } from "@/lib/projects";
import { blockingIssues, validateFeature } from "@/lib/validation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { basemapStyle, type BasemapId } from "@/lib/basemaps";
import {
  createFeature,
  defaultAttributes,
  removeFeature,
  restoreFeature,
  featureAttributes,
  featureGeometry,
  fetchCategories,
  fetchDatasets,
  fetchFeatureCount,
  fetchFeatures,
  fetchProfiles,
  layerDisplay,
  logActivity,
  qk,
  updateFeature,
  type Attributes,
  type FeatureBounds,
  type FeaturePatch,
  type FeatureRow,
  type GeomType,
} from "@/lib/data";

import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  geometryArea,
  geometryBounds,
  geometryCentre,
  geometryLength,
  isValidGeometry,
  lngLatOrDefault,
  safeBounds,
  safeLngLat,
} from "@/lib/geo";
import { ensurePmtilesProtocol } from "@/lib/pmtiles";

import "maplibre-gl/dist/maplibre-gl.css";

const FEATURE_SOURCE = "dt-features";
const FEATURE_LAYERS = ["dt-fill", "dt-outline", "dt-line", "dt-point"];
const IMAGERY_SOURCE = "dt-imagery";
const IMAGERY_LAYER = "dt-imagery-layer";
const AREA_SOURCE = "dt-areas";
const AREA_LAYERS = ["dt-area-fill", "dt-area-outline"];

const GEOM_FOR_TOOL: Record<Exclude<Tool, "pan" | "select">, GeomType> = {
  polygon: "polygon",
  rectangle: "polygon",
  linestring: "line",
  point: "point",
};

const DRAW_MODE_FOR_GEOMETRY: Record<string, string> = {
  Polygon: "polygon",
  LineString: "linestring",
  Point: "point",
};

type UndoStep = { undo: () => Promise<void>; redo: () => Promise<void> };

/** Above this many features the map reads only what the viewport covers. */
const LARGE_PROJECT = 4000;

/**
 * MapLibre's isStyleLoaded() also waits for every source's tiles, so a large
 * PMTiles archive that is still streaming keeps it false indefinitely. Adding
 * sources, layers and the drawing engine only needs the style itself parsed.
 */
function styleParsed(map: MapLibreMap): boolean {
  const style = (map as unknown as { style?: { _loaded?: boolean } }).style;
  return Boolean(style?._loaded);
}

/** Tracks the theme class on <html> so the map restyles with the app toggle. */
function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const read = () => setIsDark(document.documentElement.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export default function MapWorkspace({ projectId }: { projectId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const pendingRef = useRef<Map<string, FeaturePatch>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef<string | null>(null);

  const isDark = useIsDarkTheme();
  const { user } = useAuth();
  const access = useProjectAccess(projectId);
  const areasQuery = useProjectAreas(projectId);
  const queryClient = useQueryClient();

  const [mapReady, setMapReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [imageryVisible, setImageryVisible] = useState(true);
  const [imageryLoading, setImageryLoading] = useState(false);

  const [tool, setTool] = useState<Tool>("pan");
  const [drawCategoryId, setDrawCategoryId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [contributorFilter, setContributorFilter] = useState("all");
  const [cursor, setCursor] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [centreLat, setCentreLat] = useState(0);
  // Current map bounds, used to read features by viewport on large projects.
  const [viewport, setViewport] = useState<FeatureBounds | null>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Bumped once each new style finishes loading; the drawing layers live in the
  // style, so they are rebuilt per epoch.
  const [styleEpoch, setStyleEpoch] = useState(0);
  // Bumped when the overlay sources are (re)created on the map.
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  // Bumped when the drawing engine attaches, so its listeners can be wired up.
  const [drawReady, setDrawReady] = useState(0);

  const [undoStack, setUndoStack] = useState<UndoStep[]>([]);
  const [redoStack, setRedoStack] = useState<UndoStep[]>([]);

  // Removing work always asks for a reason, which is kept on the record.
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeReason, setRemoveReason] = useState("");

  const categoriesQuery = useQuery({
    queryKey: qk.categories(projectId),
    queryFn: () => fetchCategories(projectId),
  });
  const datasetsQuery = useQuery({
    queryKey: qk.datasets(projectId),
    queryFn: () => fetchDatasets(projectId),
  });
  // Large projects are read by viewport instead of whole-project, using the
  // stored bounding boxes and their index.
  const featureCountQuery = useQuery({
    queryKey: [...qk.features(projectId), "count"],
    queryFn: () => fetchFeatureCount(projectId),
    staleTime: 60_000,
  });
  const largeProject = (featureCountQuery.data ?? 0) > LARGE_PROJECT;
  const loadBounds = largeProject ? viewport : null;
  const boundsKey = loadBounds
    ? [loadBounds.west, loadBounds.south, loadBounds.east, loadBounds.north]
        .map((value) => value.toFixed(2))
        .join(",")
    : "all";
  const featuresQuery = useQuery({
    queryKey: [...qk.features(projectId), boundsKey],
    queryFn: () => fetchFeatures(projectId, loadBounds),
    enabled: !largeProject || Boolean(loadBounds),
    placeholderData: (previous) => previous,
  });
  const profilesQuery = useQuery({ queryKey: qk.profiles, queryFn: fetchProfiles });
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const allCategories = categoriesQuery.data ?? [];
  // Retired layers stay on existing features but are no longer offered, and a
  // layer hidden from contributors is only listed for reviewers/managers.
  const categories = useMemo(
    () =>
      allCategories.filter(
        (item) => item.visible_to_contributors || access.canReview || access.canManage,
      ),
    [allCategories, access.canReview, access.canManage],
  );
  const datasets = useMemo(
    () => (datasetsQuery.data ?? []).filter((item) => item.is_published || access.canManage),
    [datasetsQuery.data, access.canManage],
  );
  const features = featuresQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  const projectBoundary = (projectQuery.data?.boundary ?? null) as Geometry | null;
  const myAreas = useMemo(
    () =>
      access.restrictedToAssignments
        ? areas.filter((area) => access.assignedAreaIds.includes(area.id))
        : areas,
    [areas, access.restrictedToAssignments, access.assignedAreaIds],
  );

  // Contributors may only draw inside a work area assigned to them. Saying so up
  // front beats letting them trace a shape the database will refuse. The
  // database guard stays exactly as it is.
  const drawBlockedReason = useMemo(() => {
    if (!access.restrictedToAssignments) return null;
    if (areas.length === 0)
      return "This project has no work areas yet. A manager needs to create one and assign it to you before you can digitize.";
    if (myAreas.length === 0)
      return "No work area is assigned to you yet. Ask a manager or supervisor to assign one.";
    return null;
  }, [access.restrictedToAssignments, areas.length, myAreas.length]);

  const dataset = datasets.find((item) => item.id === datasetId) ?? null;
  const selected = features.find((item) => item.id === selectedId) ?? null;
  const selectedCategory = allCategories.find((item) => item.id === selected?.category_id) ?? null;
  // Approved features are locked for everyone but reviewers; another person's
  // feature is editable only where a manager allowed peer editing on the layer.
  // The database enforces the same rule, so this only shapes the interface.
  const canEditSelected = Boolean(
    selected &&
    user &&
    (access.canReview ||
      (selected.status !== "verified" &&
        access.can("edit") &&
        (selected.created_by === user.id || selectedCategory?.editable_by_peers === true))),
  );

  const invalidateFeatures = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.features(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.activity(projectId) });
  }, [queryClient, projectId]);

  // Open on the sharpest published dataset so contributors land on real imagery
  // rather than a coarse low-zoom archive.
  useEffect(() => {
    if (datasetId || datasets.length === 0) return;
    const published = datasets.filter((item) => item.is_published);
    const pool = published.length > 0 ? published : datasets;
    const best = [...pool].sort((a, b) => (b.max_zoom ?? 0) - (a.max_zoom ?? 0))[0];
    if (best) setDatasetId(best.id);
  }, [datasets, datasetId]);

  // One "started work" entry per person per session, for the timeline.
  useEffect(() => {
    if (!user) return;
    const sessionKey = `ddigitize.started.${projectId}`;
    try {
      if (window.sessionStorage.getItem(sessionKey)) return;
      window.sessionStorage.setItem(sessionKey, "1");
    } catch {
      return;
    }
    void logActivity(projectId, "work.started", "Opened the project to digitize");
  }, [projectId, user]);

  /* ---------------- autosave ---------------- */

  // Unsaved edits are mirrored in this browser so a crash, a closed tab or a
  // dropped connection does not lose them: they are replayed on the next visit.
  const recoveryKey = `ddigitize.unsaved.${projectId}`;

  const rememberPending = useCallback(() => {
    try {
      const entries = Array.from(pendingRef.current.entries());
      if (entries.length === 0) window.localStorage.removeItem(recoveryKey);
      else window.localStorage.setItem(recoveryKey, JSON.stringify(entries));
    } catch {
      /* private browsing or a full store: autosave still works normally */
    }
  }, [recoveryKey]);

  const flush = useCallback(async () => {
    const entries = Array.from(pendingRef.current.entries());
    if (entries.length === 0) return;
    setSaveStatus("saving");
    try {
      for (const [id, patch] of entries) {
        await updateFeature(id, patch);
        // Only drop an edit once the database has confirmed it.
        pendingRef.current.delete(id);
      }
      rememberPending();
      setSaveStatus("saved");
      invalidateFeatures();
      setTimeout(() => setSaveStatus((current) => (current === "saved" ? "idle" : current)), 2500);
    } catch (error) {
      rememberPending();
      setSaveStatus("error");
      toast.error(error instanceof Error ? error.message : "Could not save this edit");
    }
  }, [invalidateFeatures, rememberPending]);

  const queuePatch = useCallback(
    (id: string, patch: FeaturePatch) => {
      const merged = { ...(pendingRef.current.get(id) ?? {}), ...patch };
      pendingRef.current.set(id, merged);
      rememberPending();
      setSaveStatus("saving");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), 700);
    },
    [flush, rememberPending],
  );

  // Replay anything left unsaved from a previous visit, once.
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (recoveredRef.current || !user) return;
    recoveredRef.current = true;
    let stored: [string, FeaturePatch][] = [];
    try {
      stored = JSON.parse(window.localStorage.getItem(recoveryKey) ?? "[]") as [
        string,
        FeaturePatch,
      ][];
    } catch {
      stored = [];
    }
    if (!Array.isArray(stored) || stored.length === 0) return;
    for (const [id, patch] of stored) pendingRef.current.set(id, patch);
    toast.info("Recovering edits that had not been saved yet.");
    void flush();
  }, [flush, recoveryKey, user]);

  // Save on the way out, so leaving the page does not strand an edit.
  useEffect(() => {
    const onHide = () => {
      if (pendingRef.current.size > 0) void flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  const pushUndo = useCallback((step: UndoStep) => {
    setUndoStack((stack) => [...stack.slice(-49), step]);
    setRedoStack([]);
  }, []);

  /* ---------------- map bootstrap ---------------- */

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    ensurePmtilesProtocol();

    const map = new MapLibreMap({
      container: containerRef.current,
      style: basemapStyle(basemap, isDark),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      maxZoom: 24,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.on("error", (event) => console.error("[map]", event.error?.message ?? event));

    map.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");

    map.on("mousemove", (event) => {
      const pair = safeLngLat(event.lngLat.lng, event.lngLat.lat);
      setCursor(pair ? { lng: pair[0], lat: pair[1] } : null);
    });
    map.on("mouseout", () => setCursor(null));
    const syncView = () => {
      setZoom(map.getZoom());
      setCentreLat(lngLatOrDefault(map.getCenter().lng, map.getCenter().lat)[1]);
    };
    map.on("move", syncView);
    // Viewport bounds, padded a little so panning does not reveal empty edges.
    const syncViewport = () => {
      const bounds = map.getBounds();
      const padLng = (bounds.getEast() - bounds.getWest()) * 0.25;
      const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.25;
      setViewport({
        west: Math.max(bounds.getWest() - padLng, -180),
        south: Math.max(bounds.getSouth() - padLat, -90),
        east: Math.min(bounds.getEast() + padLng, 180),
        north: Math.min(bounds.getNorth() + padLat, 90),
      });
    };
    map.on("moveend", syncViewport);
    // "idle" (not "load") means the style is fully parsed, so addSource/addLayer
    // and the drawing adapter cannot hit "Style is not done loading".
    map.once("idle", () => {
      syncView();
      syncViewport();
      setMapReady(true);
    });

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- overlays (re-applied on every style load) ---------------- */

  const applyOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleParsed(map)) return;

    // styledata can fire before the style is fully parsed, and MapLibre throws
    // "Style is not done loading" from addSource. The retry happens on the next
    // styledata/idle event, so swallowing it here is safe.
    try {
      if (dataset && !map.getSource(IMAGERY_SOURCE)) {
        const bounds = safeBounds(dataset.bounds);
        map.addSource(IMAGERY_SOURCE, {
          type: "raster",
          url: `pmtiles://${dataset.url}`,
          // GDAL/pmtiles archives are 256 px unless they advertise 512 in the
          // file name; declaring the wrong size halves the visible resolution.
          tileSize: /512/.test(dataset.url) ? 512 : 256,
          // The source keeps its own minzoom so MapLibre does not request tiles
          // the archive does not hold, but the layer must stay unrestricted so
          // the deepest tiles are over-zoomed instead of disappearing.
          minzoom: dataset.min_zoom ?? 0,
          maxzoom: dataset.max_zoom ?? 22,
          ...(bounds
            ? {
                bounds: [bounds.west, bounds.south, bounds.east, bounds.north] as [
                  number,
                  number,
                  number,
                  number,
                ],
              }
            : {}),
        });
        map.addLayer(
          {
            id: IMAGERY_LAYER,
            type: "raster",
            source: IMAGERY_SOURCE,
            // No layer maxzoom: MapLibre keeps over-zooming the deepest available
            // tiles, so people can magnify past the archive's native resolution.
            paint: { "raster-opacity": opacity, "raster-resampling": "linear" },
            layout: { visibility: imageryVisible ? "visible" : "none" },
          },
          // Imagery stays underneath the work areas and digitized features when
          // those layers already exist (e.g. after switching dataset).
          map.getLayer("dt-area-fill") ? "dt-area-fill" : undefined,
        );
      }

      if (!map.getSource(AREA_SOURCE)) {
        map.addSource(AREA_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "dt-area-fill",
          type: "fill",
          source: AREA_SOURCE,
          paint: {
            "fill-color": ["case", ["get", "mine"], "#14b8a6", "#0f172a"],
            "fill-opacity": ["case", ["get", "mine"], 0.06, 0.35],
          },
        });
        map.addLayer({
          id: "dt-area-outline",
          type: "line",
          source: AREA_SOURCE,
          paint: {
            "line-color": ["case", ["get", "mine"], "#2dd4bf", "#64748b"],
            "line-width": ["case", ["get", "mine"], 2.5, 1],
            "line-dasharray": ["case", ["get", "mine"], ["literal", [1, 0]], ["literal", [2, 2]]],
          },
        });
      }

      if (!map.getSource(FEATURE_SOURCE)) {
        map.addSource(FEATURE_SOURCE, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "dt-fill",
          type: "fill",
          source: FEATURE_SOURCE,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": ["get", "color"],
            // Per-layer opacity and width come from the layer's display settings.
            "fill-opacity": [
              "case",
              ["get", "isSelected"],
              0.45,
              ["coalesce", ["get", "fillOpacity"], 0.22],
            ],
          },
        });
        map.addLayer({
          id: "dt-outline",
          type: "line",
          source: FEATURE_SOURCE,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": [
              "case",
              ["get", "isSelected"],
              3,
              ["coalesce", ["get", "lineWidth"], 1.5],
            ],
          },
        });
        map.addLayer({
          id: "dt-line",
          type: "line",
          source: FEATURE_SOURCE,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": [
              "case",
              ["get", "isSelected"],
              5,
              ["*", ["coalesce", ["get", "lineWidth"], 1.5], 1.7],
            ],
          },
        });
        map.addLayer({
          id: "dt-point",
          type: "circle",
          source: FEATURE_SOURCE,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["case", ["get", "isSelected"], 8, 5],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });

        // The data effects below only run once the sources exist, so they are
        // re-run whenever the overlay sources are (re)created.
        setOverlayEpoch((epoch) => epoch + 1);
      }
    } catch {
      /* retried on the next style event */
    }
  }, [dataset, opacity, imageryVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyOverlays();
    const handler = () => applyOverlays();
    map.on("styledata", handler);
    map.on("idle", handler);
    return () => {
      map.off("styledata", handler);
      map.off("idle", handler);
    };
  }, [applyOverlays, mapReady]);

  // Basemap / theme switch: MapLibre drops custom sources, so overlays are re-added.
  // The map is created with this style already, so the first run is skipped —
  // calling setStyle during the initial load leaves the canvas blank.
  const styleSignature = `${basemap}:${isDark ? "dark" : "light"}`;
  const appliedStyle = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyle.current === null) {
      appliedStyle.current = styleSignature;
      return;
    }
    if (appliedStyle.current === styleSignature) return;
    appliedStyle.current = styleSignature;
    map.setStyle(basemapStyle(basemap, isDark), { diff: false });
    map.once("idle", () => setStyleEpoch((epoch) => epoch + 1));
  }, [basemap, isDark, mapReady, styleSignature]);

  // Fly to the imagery: its stored bounds when usable, otherwise its centre.
  const zoomToImagery = useCallback(() => {
    const map = mapRef.current;
    if (!map || !dataset) return;
    const bounds = safeBounds(dataset.bounds);
    if (bounds) {
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ] as LngLatBoundsLike,
        { padding: 40, duration: 800 },
      );
      return;
    }
    const centre = safeLngLat(dataset.center_lng, dataset.center_lat);
    if (centre) map.flyTo({ center: centre, zoom: Math.max(14, dataset.min_zoom ?? 14) });
  }, [dataset]);

  // Dataset switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !styleParsed(map)) return;
    if (map.getLayer(IMAGERY_LAYER)) map.removeLayer(IMAGERY_LAYER);
    if (map.getSource(IMAGERY_SOURCE)) map.removeSource(IMAGERY_SOURCE);
    applyOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, mapReady]);

  // Archives that start at a deep minimum zoom draw nothing at the world view,
  // so the camera is moved onto the imagery as soon as its layer really exists —
  // the dataset-switch effect above can run before the style is parsed.
  const zoomedFor = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !datasetId) return;
    if (zoomedFor.current === datasetId) return;
    if (!map.getLayer(IMAGERY_LAYER)) return;
    // A contributor's camera belongs on their own work area; letting the imagery
    // fit run as well makes the two fly animations fight each other.
    if (access.restrictedToAssignments && myAreas.length > 0) {
      zoomedFor.current = datasetId;
      return;
    }
    zoomedFor.current = datasetId;
    zoomToImagery();
  }, [
    datasetId,
    mapReady,
    overlayEpoch,
    styleEpoch,
    zoomToImagery,
    access.restrictedToAssignments,
    myAreas,
  ]);

  // Streaming indicator: PMTiles tiles arrive over HTTP range requests in rapid
  // bursts, so the label only appears after a full second of sustained loading
  // and then stays put for a second — otherwise it strobes while panning.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let shownAt = 0;
    let visible = false;

    const show = () => {
      visible = true;
      shownAt = Date.now();
      setImageryLoading(true);
    };
    const hide = () => {
      visible = false;
      setImageryLoading(false);
    };

    const update = () => {
      const source = map.getSource(IMAGERY_SOURCE);
      const busy = Boolean(source) && !map.areTilesLoaded();
      if (busy) {
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
        if (visible || showTimer) return;
        showTimer = setTimeout(() => {
          showTimer = null;
          show();
        }, 1000);
        return;
      }
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (!visible || hideTimer) return;
      const remaining = Math.max(0, 1000 - (Date.now() - shownAt));
      hideTimer = setTimeout(() => {
        hideTimer = null;
        hide();
      }, remaining);
    };

    map.on("dataloading", update);
    map.on("data", update);
    map.on("idle", update);
    return () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
      map.off("dataloading", update);
      map.off("data", update);
      map.off("idle", update);
    };
  }, [mapReady, datasetId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(IMAGERY_LAYER)) return;
    map.setPaintProperty(IMAGERY_LAYER, "raster-opacity", opacity);
    map.setLayoutProperty(IMAGERY_LAYER, "visibility", imageryVisible ? "visible" : "none");
  }, [opacity, imageryVisible, dataset, mapReady]);

  /* ---------------- feature rendering ---------------- */

  const visibleFeatures = useMemo(() => {
    const term = search.trim().toLowerCase();
    const allowed = new Set(categories.map((item) => item.id));
    return features.filter((row) => {
      // A layer hidden from contributors is not drawn for them either.
      if (row.category_id && !allowed.has(row.category_id)) return false;
      if (row.category_id && hidden.has(row.category_id)) return false;
      if (contributorFilter !== "all" && row.created_by !== contributorFilter) return false;
      if (!term) return true;
      const category = categories.find((item) => item.id === row.category_id);
      const haystack = [
        category?.name ?? "",
        row.status,
        ...Object.values(featureAttributes(row)).map((value) => String(value ?? "")),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [features, hidden, contributorFilter, search, categories]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(FEATURE_SOURCE);
    if (!source || !("setData" in source)) return;

    const zoomNow = map.getZoom();
    const collection: Feature[] = visibleFeatures
      .filter((row) => row.id !== editingRef.current)
      .filter((row) => isValidGeometry(row.geometry))
      .map((row) => {
        const category = categories.find((item) => item.id === row.category_id);
        const display = layerDisplay(category);
        return {
          type: "Feature",
          // No GeoJSON "id": MapLibre only accepts numeric ids, and a UUID keeps
          // the source from tiling at all. The id travels in properties instead.
          geometry: featureGeometry(row),
          properties: {
            id: row.id,
            color: category?.color ?? "#94a3b8",
            isSelected: row.id === selectedId,
            status: row.status,
            fillOpacity: display.fillOpacity,
            lineWidth: display.lineWidth,
            minZoom: display.minZoom,
          },
        } satisfies Feature;
      })
      // Layers configured to appear from a given zoom stay out of the source
      // until then, which keeps big projects light at overview zooms.
      .filter((item) => zoomNow >= Number(item.properties?.["minZoom"] ?? 0));

    (source as { setData: (data: unknown) => void }).setData({
      type: "FeatureCollection",
      features: collection,
    });
  }, [visibleFeatures, categories, selectedId, mapReady, styleEpoch, overlayEpoch, zoom]);

  // Work areas: the ones assigned to this person read as open, the rest dimmed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(AREA_SOURCE);
    if (!source || !("setData" in source)) return;
    const mine = new Set(myAreas.map((area) => area.id));
    const collection: Feature[] = areas
      .filter((area) => Boolean(areaBoundary(area)))
      .map((area) => ({
        type: "Feature",
        // Same as above: the UUID stays in properties only.
        geometry: areaBoundary(area),
        properties: { id: area.id, name: area.name, mine: mine.has(area.id) },
      }));
    (source as { setData: (data: unknown) => void }).setData({
      type: "FeatureCollection",
      features: collection,
    });
  }, [areas, myAreas, mapReady, styleEpoch, overlayEpoch]);

  // Contributors open on their own patch of work.
  const fittedAreas = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || fittedAreas.current) return;
    if (!access.restrictedToAssignments || myAreas.length === 0) return;
    const boundary = areaBoundary(myAreas[0] as WorkArea);
    const ring = boundary?.coordinates?.[0];
    if (!ring || ring.length === 0) return;
    const lngs = ring.map((pair) => pair[0] as number);
    const lats = ring.map((pair) => pair[1] as number);
    fittedAreas.current = true;
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ] as LngLatBoundsLike,
      { padding: 60, duration: 800 },
    );
  }, [access.restrictedToAssignments, myAreas, mapReady]);

  /* ---------------- click to select ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handler = (event: { point: { x: number; y: number } }) => {
      const layers = FEATURE_LAYERS.filter((id) => map.getLayer(id));
      if (layers.length === 0) return;
      const hits = map.queryRenderedFeatures(event.point as never, { layers });
      const id = hits[0]?.properties?.["id"];
      if (typeof id === "string") {
        setSelectedId(id);
        setTool((current) => (current === "pan" ? "select" : current));
      }
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [mapReady]);

  /* ---------------- terra-draw ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const snapping = { toCoordinate: true, toLine: true } as const;
    const coordinateFlags = {
      midpoints: true,
      draggable: true,
      deletable: true,
      snappable: true,
    };

    let draw: TerraDraw | null = null;

    // The adapter needs a fully parsed style. "idle" can fire while MapLibre is
    // still finishing the style, so initialisation is retried on later style
    // events instead of being abandoned after one attempt.
    const init = () => {
      if (draw || !styleParsed(map)) return;

      const instance = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPointMode(),
          new TerraDrawLineStringMode({ snapping }),
          new TerraDrawPolygonMode({ snapping }),
          new TerraDrawRectangleMode(),
          new TerraDrawSelectMode({
            flags: {
              point: { feature: { draggable: true } },
              linestring: { feature: { draggable: true, coordinates: coordinateFlags } },
              polygon: { feature: { draggable: true, coordinates: coordinateFlags } },
              rectangle: { feature: { draggable: true, coordinates: coordinateFlags } },
            },
          }),
        ],
      });
      try {
        instance.start();
        instance.setMode("static");
      } catch (error) {
        console.error("Could not start the drawing tools", error);
        return;
      }
      draw = instance;
      drawRef.current = instance;
      map.off("idle", init);
      map.off("styledata", init);
      // Lets the mode/listener effects below attach to the live instance.
      setDrawReady((count) => count + 1);
    };

    init();
    if (!draw) {
      map.on("idle", init);
      map.on("styledata", init);
    }

    return () => {
      map.off("idle", init);
      map.off("styledata", init);
      try {
        draw?.stop();
      } catch {
        /* the style may already be gone */
      }
      drawRef.current = null;
    };
  }, [mapReady, styleEpoch]);

  // Tool → draw mode
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      draw.setMode(tool === "pan" ? "static" : tool);
    } catch (error) {
      console.error("Could not switch drawing tool", error);
    }
  }, [tool, mapReady, styleEpoch, drawReady]);

  const createMutation = useMutation({
    mutationFn: async (geometry: Geometry) => {
      if (!user) throw new Error("Sign in to digitize features");
      const area = areaForGeometry(geometry, areas);
      const category = categories.find((item) => item.id === drawCategoryId) ?? null;
      if (category && !category.is_active) {
        throw new Error(`${category.name} is no longer in use, so nothing was saved.`);
      }
      // Default values configured on the layer's fields are filled in up front.
      const attributes = defaultAttributes(category);

      // Live checks: geometry type, size, coordinates, project and work-area
      // boundaries, self-intersection, duplicates, overlap and attribute rules.
      const issues = validateFeature({
        geometry,
        category,
        attributes,
        areas,
        assignedAreaIds: access.assignedAreaIds,
        restrictedToAssignments: access.restrictedToAssignments,
        containingArea: area,
        siblings: features,
        projectBoundary,
      });

      const blocking = blockingIssues(issues);
      if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join(" "));
      for (const issue of issues) {
        if (issue.severity === "warning") toast.warning(issue.message);
      }

      const row = await createFeature({
        projectId,
        workAreaId: area?.id ?? null,
        categoryId: category?.id ?? null,
        datasetId: dataset?.id ?? null,
        geometry,
        attributes,
        areaSqm: geometryArea(geometry),
        lengthM: geometryLength(geometry),
        createdBy: user.id,
      });
      await logActivity(projectId, "created", `Digitized a ${category?.name ?? "feature"}`, row.id);
      return row;
    },
    onSuccess: (row) => {
      invalidateFeatures();
      setSelectedId(row.id);
      setSaveStatus("saved");
      pushUndo({
        undo: async () => {
          await removeFeature(row.id, "Undone straight after digitizing");
          invalidateFeatures();
        },
        redo: async () => {
          if (!user) return;
          await createFeature({
            projectId,
            workAreaId: row.work_area_id,
            categoryId: row.category_id,
            datasetId: row.dataset_id,
            geometry: featureGeometry(row),
            attributes: featureAttributes(row),
            areaSqm: Number(row.area_sqm),
            lengthM: Number(row.length_m),
            createdBy: user.id,
          });
          invalidateFeatures();
        },
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save this feature");
      setSaveStatus("error");
    },
  });

  // New geometry finished
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const onFinish = (id: string | number, context: { action: string }) => {
      if (context.action !== "draw") return;
      const snapshot = draw.getSnapshotFeature(id);
      if (!snapshot) return;
      draw.removeFeatures([id]);
      const geometry = snapshot.geometry as Geometry;
      if (!isValidGeometry(geometry)) {
        toast.error("That shape had invalid coordinates and was not saved.");
        return;
      }
      createMutation.mutate(geometry);
    };
    draw.on("finish", onFinish);
    return () => {
      draw.off("finish", onFinish);
    };
  }, [createMutation, mapReady, drawReady]);

  // Load the selected feature into terra-draw for vertex editing
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.clear();
    editingRef.current = null;

    if (!selected || !canEditSelected || tool !== "select") return;
    const geometry = featureGeometry(selected);
    const mode = DRAW_MODE_FOR_GEOMETRY[geometry.type];
    if (!mode || !isValidGeometry(geometry)) return;
    try {
      draw.addFeatures([
        {
          type: "Feature",
          id: selected.id,
          geometry: geometry as never,
          properties: { mode },
        } as never,
      ]);
      editingRef.current = selected.id;
    } catch {
      editingRef.current = null;
    }
  }, [selectedId, canEditSelected, tool, selected, styleEpoch, drawReady]);

  // Geometry edits → autosave
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const onChange = (ids: (string | number)[], type: string) => {
      if (type !== "update") return;
      const id = editingRef.current;
      if (!id || !ids.map(String).includes(id)) return;
      const snapshot = draw.getSnapshotFeature(id);
      if (!snapshot) return;
      const geometry = snapshot.geometry as Geometry;
      if (!isValidGeometry(geometry)) return;
      queuePatch(id, {
        geometry,
        areaSqm: geometryArea(geometry),
        lengthM: geometryLength(geometry),
      });
    };
    draw.on("change", onChange);
    return () => {
      draw.off("change", onChange);
    };
  }, [queuePatch, mapReady, drawReady]);

  /* ---------------- actions ---------------- */

  const handleTool = (next: Tool) => {
    if (next !== "pan" && next !== "select" && !user) {
      toast.error("Sign in to start digitizing.");
      return;
    }
    if (next !== "pan" && next !== "select" && drawBlockedReason) {
      toast.error(drawBlockedReason);
      return;
    }
    setTool(next);

    if (next !== "pan" && next !== "select") {
      const wanted = GEOM_FOR_TOOL[next];
      const current = categories.find((item) => item.id === drawCategoryId);
      if (!current || current.geometry_type !== wanted) {
        const match = categories.find((item) => item.geometry_type === wanted);
        setDrawCategoryId(match?.id ?? null);
        if (!match) toast.error(`No ${wanted} category exists yet. Ask an admin to add one.`);
      }
    }
  };

  const patchSelected = (patch: FeaturePatch) => {
    if (!selected || !canEditSelected) return;
    const previous: FeaturePatch = {
      ...(patch.attributes ? { attributes: featureAttributes(selected) as Attributes } : {}),
      ...(patch.status ? { status: selected.status } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: selected.category_id } : {}),
      ...(patch.reviewNote !== undefined ? { reviewNote: selected.review_note } : {}),
    };
    const id = selected.id;
    queuePatch(id, patch);
    pushUndo({
      undo: async () => {
        await updateFeature(id, previous);
        invalidateFeatures();
      },
      redo: async () => {
        await updateFeature(id, patch);
        invalidateFeatures();
      },
    });
  };

  // Work is never erased outright: it is marked as removed with a reason, so the
  // organisation keeps a record and a manager can bring it back.
  const confirmRemove = async (reason: string) => {
    if (!selected || !canEditSelected || !user) return;
    const row = selected;
    try {
      await removeFeature(row.id, reason);
      setRemoveOpen(false);
      setRemoveReason("");
      setSelectedId(null);
      invalidateFeatures();
      toast.success("Removed and recorded. A manager can restore it.");
      pushUndo({
        undo: async () => {
          await restoreFeature(row.id);
          invalidateFeatures();
        },
        redo: async () => {
          await removeFeature(row.id, reason);
          invalidateFeatures();
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove this feature");
    }
  };

  const runUndo = async () => {
    const step = undoStack[undoStack.length - 1];
    if (!step) return;
    setUndoStack((stack) => stack.slice(0, -1));
    try {
      await step.undo();
      setRedoStack((stack) => [...stack, step]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Undo failed");
    }
  };

  const runRedo = async () => {
    const step = redoStack[redoStack.length - 1];
    if (!step) return;
    setRedoStack((stack) => stack.slice(0, -1));
    try {
      await step.redo();
      setUndoStack((stack) => [...stack, step]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Redo failed");
    }
  };

  const zoomToSelected = () => {
    const map = mapRef.current;
    if (!map || !selected) return;
    const geometry = featureGeometry(selected);
    const bounds = geometryBounds(geometry);
    if (bounds) {
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ] as LngLatBoundsLike,
        { padding: 80, maxZoom: 21, duration: 600 },
      );
      return;
    }
    const centre = safeLngLat(...geometryCentre(geometry));
    if (centre) map.flyTo({ center: centre, zoom: 19 });
  };

  const toggleCategory = (id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const drawCategories = useMemo(() => {
    // Retired layers stay visible on old features but cannot be drawn into.
    const active = categories.filter((item) => item.is_active);
    if (tool === "pan" || tool === "select") return active;
    return active.filter((item) => item.geometry_type === GEOM_FOR_TOOL[tool]);
  }, [categories, tool]);

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-panel">
            <ScrollArea className="min-h-0 flex-1">
              <BasemapPanel
                basemap={basemap}
                onBasemap={setBasemap}
                datasets={datasets}
                datasetId={datasetId}
                onDataset={setDatasetId}
                opacity={opacity}
                onOpacity={setOpacity}
                imageryVisible={imageryVisible}
                onImageryVisible={setImageryVisible}
                loading={imageryLoading}
                onZoomToImagery={zoomToImagery}
              />
              <div className="border-t border-border px-3 py-3">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Digitizing as
                </Label>
                <Select value={drawCategoryId ?? ""} onValueChange={setDrawCategoryId}>
                  <SelectTrigger className="mt-1.5 h-8 text-xs">
                    <SelectValue placeholder="Pick a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {drawCategories.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border-t border-border">
                <LayersPanel
                  categories={categories}
                  features={visibleFeatures}
                  profiles={profiles}
                  hidden={hidden}
                  onToggleCategory={toggleCategory}
                  search={search}
                  onSearch={setSearch}
                  contributorFilter={contributorFilter}
                  onContributorFilter={setContributorFilter}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    const row = features.find((item) => item.id === id);
                    const map = mapRef.current;
                    if (row && map) {
                      const centre = safeLngLat(...geometryCentre(featureGeometry(row)));
                      if (centre) map.flyTo({ center: centre, zoom: Math.max(map.getZoom(), 17) });
                    }
                  }}
                />
              </div>
            </ScrollArea>
          </aside>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* MapLibre's stylesheet forces position:relative on its container, which
              cancels absolute positioning and collapses the height — size it directly. */}
          <div ref={containerRef} className="h-full w-full" />

          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="pointer-events-auto size-8"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? "Collapse panels" : "Expand panels"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="size-4" />
              ) : (
                <PanelLeftOpen className="size-4" />
              )}
            </Button>
            <ToolRail
              tool={tool}
              onTool={handleTool}
              disabled={!user}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onUndo={() => void runUndo()}
              onRedo={() => void runRedo()}
              onDelete={() => setRemoveOpen(true)}
              canDelete={canEditSelected}
              drawBlockedReason={drawBlockedReason}
            />
            {drawBlockedReason && (
              <p className="pointer-events-auto max-w-64 rounded-md border border-border bg-panel/95 p-2 text-xs text-muted-foreground shadow-lg backdrop-blur">
                {drawBlockedReason}
              </p>
            )}
          </div>

          {selected && (
            <div className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col overflow-hidden rounded-md border border-border bg-panel/95 shadow-xl backdrop-blur">
              <AttributePanel
                feature={selected as FeatureRow}
                categories={categories}
                profiles={profiles}
                canEdit={canEditSelected}
                canReview={access.canReview}
                workAreas={areas}
                onPatch={patchSelected}
                onDelete={() => setRemoveOpen(true)}
                onClose={() => setSelectedId(null)}
                onZoom={zoomToSelected}
              />
            </div>
          )}
        </div>
      </div>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this feature?</DialogTitle>
            <DialogDescription>
              It comes off the map but stays on the record, so a manager can restore it. Tell us why
              it is being removed.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            className="min-h-20 text-sm"
            maxLength={300}
            placeholder="Reason for removing this feature"
            value={removeReason}
            onChange={(event) => setRemoveReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemoveOpen(false)}>
              Keep it
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={removeReason.trim().length < 3}
              onClick={() => void confirmRemove(removeReason.trim())}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StatusBar
        cursor={cursor}
        centreLat={centreLat}
        zoom={zoom}
        featureCount={visibleFeatures.length}
        saveStatus={saveStatus}
      />
    </TooltipProvider>
  );
}
