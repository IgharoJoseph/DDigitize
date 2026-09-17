import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Radar, TriangleAlert, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchDatasets, qk } from "@/lib/data";
import { safeBounds, safeLngLat } from "@/lib/geo";
import { inspectPmtiles, type InspectResult } from "@/lib/pmtiles";

const SAMPLES = [
  {
    name: "USGS Mt Whitney aerial",
    url: "https://pmtiles.io/usgs-mt-whitney-8-15-webp-512.pmtiles",
    note: "High-resolution public aerial imagery (zoom 8–15) — good for tracing practice.",
  },
  {
    name: "USGS terrain raster",
    url: "https://pmtiles.io/stamen_toner(raster)CC-BY+ODbL_z3.pmtiles",
    note: "Small raster archive, useful to confirm the PMTiles reader is working.",
  },
];

const schema = z.object({
  name: z.string().trim().min(2, { message: "Name the dataset" }).max(80),
  url: z
    .string()
    .trim()
    .url({ message: "Enter the full https URL of the .pmtiles file" })
    .max(500)
    .refine((value) => value.startsWith("https://"), { message: "Use an https URL" }),
  description: z.string().trim().max(400).optional(),
  gsdCm: z.string().trim().max(10).optional(),
  flightDate: z.string().trim().max(20).optional(),
  minZoom: z.coerce.number().int().min(0).max(24),
  maxZoom: z.coerce.number().int().min(0).max(24),
  centreLng: z.string().trim().max(30).optional(),
  centreLat: z.string().trim().max(30).optional(),
});

const GDAL_COMMANDS = [
  {
    label: "1 · Reproject and tile the GeoTIFF (Web Mercator)",
    command:
      "gdalwarp -t_srs EPSG:3857 -r bilinear -co TILED=YES -co COMPRESS=JPEG ortho.tif ortho_3857.tif",
  },
  {
    label: "2 · Build an MBTiles pyramid up to zoom 22",
    command: "gdal_translate -of MBTILES ortho_3857.tif ortho.mbtiles -co ZOOM_LEVEL_STRATEGY=UPPER",
  },
  {
    label: "3 · Add overviews so lower zooms render",
    command: "gdaladdo -r average ortho.mbtiles 2 4 8 16 32 64 128",
  },
  {
    label: "4 · Convert to a single PMTiles archive",
    command: "pmtiles convert ortho.mbtiles ortho.pmtiles",
  },
  {
    label: "5 · Upload to Cloudflare R2 (free egress) and make it public",
    command: "rclone copy ortho.pmtiles r2:my-bucket/ --progress",
  },
];

export function ImageryTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const datasetsQuery = useQuery({
    queryKey: qk.datasets(projectId),
    queryFn: () => fetchDatasets(projectId),
  });
  const datasets = datasetsQuery.data ?? [];

  const [form, setForm] = useState({
    name: "",
    url: "",
    description: "",
    gsdCm: "",
    flightDate: "",
    minZoom: "0",
    maxZoom: "22",
    centreLng: "",
    centreLat: "",
  });
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const runInspect = async () => {
    if (!form.url.trim().startsWith("https://")) {
      toast.error("Enter the full https URL of the .pmtiles file first");
      return;
    }
    setInspecting(true);
    const result = await inspectPmtiles(form.url.trim());
    setInspection(result);
    setInspecting(false);
    if (result.ok) {
      setForm((current) => ({
        ...current,
        minZoom: String(result.minZoom ?? current.minZoom),
        maxZoom: String(result.maxZoom ?? current.maxZoom),
        centreLng: result.center ? String(result.center.lng) : current.centreLng,
        centreLat: result.center ? String(result.center.lat) : current.centreLat,
      }));
    }
  };

  const save = async (publish: boolean) => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the dataset details");
      return;
    }
    if (parsed.data.minZoom > parsed.data.maxZoom) {
      toast.error("Minimum zoom cannot exceed maximum zoom");
      return;
    }
    // Coordinates are only stored when they are a valid [lng, lat] pair.
    const centre = safeLngLat(parsed.data.centreLng, parsed.data.centreLat);
    if ((parsed.data.centreLng || parsed.data.centreLat) && !centre) {
      toast.error("Centre must be a longitude between -180 and 180 and a latitude between -90 and 90");
      return;
    }
    const bounds = safeBounds(inspection?.bounds ?? null);

    setSaving(true);
    const { error } = await supabase.from("imagery_datasets").insert({
      project_id: projectId,
      name: parsed.data.name,
      url: parsed.data.url,
      description: parsed.data.description || null,
      gsd_cm: parsed.data.gsdCm ? Number(parsed.data.gsdCm) : null,
      flight_date: parsed.data.flightDate || null,
      min_zoom: parsed.data.minZoom,
      max_zoom: parsed.data.maxZoom,
      center_lng: centre ? centre[0] : null,
      center_lat: centre ? centre[1] : null,
      bounds: bounds ? (bounds as unknown as never) : null,
      tile_type: inspection?.tileType?.includes("vector") ? "vector" : "raster",
      is_published: publish,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(publish ? "Dataset published to contributors" : "Dataset saved as a draft");
    setForm({
      name: "",
      url: "",
      description: "",
      gsdCm: "",
      flightDate: "",
      minZoom: "0",
      maxZoom: "22",
      centreLng: "",
      centreLat: "",
    });
    setInspection(null);
    void queryClient.invalidateQueries({ queryKey: qk.datasets(projectId) });
  };

  const togglePublish = async (id: string, next: boolean) => {
    const { error } = await supabase
      .from("imagery_datasets")
      .update({ is_published: next })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: qk.datasets(projectId) });
  };

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h2 className="text-base font-semibold tracking-tight">Imagery</h2>
          <p className="text-sm text-muted-foreground">
            Register a PMTiles archive by URL, verify it responds to ranged requests, then publish it.
          </p>
        </div>

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">Register a dataset</CardTitle>
            <CardDescription>
              Host the archive anywhere that serves HTTP range requests with CORS: Cloudflare R2,
              AWS S3, or Cloud storage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ds-url">PMTiles URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="ds-url"
                    value={form.url}
                    maxLength={500}
                    placeholder="https://pub-xxxx.r2.dev/ortho.pmtiles"
                    onChange={(event) => set("url")(event.target.value)}
                  />
                  <Button variant="outline" onClick={() => void runInspect()} disabled={inspecting}>
                    <Radar className="mr-1.5 size-4" /> Inspect
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ds-name">Name</Label>
                <Input
                  id="ds-name"
                  value={form.name}
                  maxLength={80}
                  onChange={(event) => set("name")(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ds-date">Flight date</Label>
                <Input
                  id="ds-date"
                  type="date"
                  value={form.flightDate}
                  onChange={(event) => set("flightDate")(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ds-gsd">GSD (cm/px)</Label>
                <Input
                  id="ds-gsd"
                  type="number"
                  step="0.1"
                  value={form.gsdCm}
                  onChange={(event) => set("gsdCm")(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ds-minz">Min zoom</Label>
                  <Input
                    id="ds-minz"
                    type="number"
                    value={form.minZoom}
                    onChange={(event) => set("minZoom")(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ds-maxz">Max zoom</Label>
                  <Input
                    id="ds-maxz"
                    type="number"
                    value={form.maxZoom}
                    onChange={(event) => set("maxZoom")(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ds-lng">Centre longitude (-180 to 180)</Label>
                <Input
                  id="ds-lng"
                  value={form.centreLng}
                  onChange={(event) => set("centreLng")(event.target.value)}
                  placeholder="11.2558"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ds-lat">Centre latitude (-90 to 90)</Label>
                <Input
                  id="ds-lat"
                  value={form.centreLat}
                  onChange={(event) => set("centreLat")(event.target.value)}
                  placeholder="43.7696"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ds-desc">Notes</Label>
                <Textarea
                  id="ds-desc"
                  value={form.description}
                  maxLength={400}
                  onChange={(event) => set("description")(event.target.value)}
                />
              </div>
            </div>

            {inspection && (
              <div
                className={
                  inspection.ok
                    ? "space-y-1 rounded border border-success/40 bg-success/10 p-3 text-xs"
                    : "space-y-1 rounded border border-destructive/40 bg-destructive/10 p-3 text-xs"
                }
              >
                <p className="flex items-center gap-1.5 font-medium">
                  {inspection.ok ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <TriangleAlert className="size-4 text-destructive" />
                  )}
                  {inspection.message}
                </p>
                {inspection.ok && (
                  <dl className="readout grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-4">
                    <div>
                      <dt>Tiles</dt>
                      <dd className="text-foreground">{inspection.tileType}</dd>
                    </div>
                    <div>
                      <dt>Zoom</dt>
                      <dd className="text-foreground">
                        {inspection.minZoom}–{inspection.maxZoom}
                      </dd>
                    </div>
                    <div>
                      <dt>Byte range</dt>
                      <dd className="text-foreground">{inspection.byteRangeMs} ms</dd>
                    </div>
                    <div>
                      <dt>Bounds</dt>
                      <dd className="text-foreground">
                        {inspection.bounds
                          ? `${inspection.bounds.west.toFixed(3)}, ${inspection.bounds.south.toFixed(3)} → ${inspection.bounds.east.toFixed(3)}, ${inspection.bounds.north.toFixed(3)}`
                          : "not declared"}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save(true)} disabled={saving}>
                Publish to contributors
              </Button>
              <Button variant="outline" onClick={() => void save(false)} disabled={saving}>
                Save as draft
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Sample presets:</span>
              {SAMPLES.map((sample) => (
                <Button
                  key={sample.url}
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setForm((current) => ({
                      ...current,
                      name: sample.name,
                      url: sample.url,
                      description: sample.note,
                    }));
                    setInspection(null);
                  }}
                >
                  <Wand2 className="mr-1.5 size-3.5" /> {sample.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">Registered datasets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{dataset.name}</p>
                  <p className="readout truncate text-[10px] text-muted-foreground">{dataset.url}</p>
                </div>
                <Badge variant="outline" className="text-[9px] uppercase">
                  z{dataset.min_zoom}–{dataset.max_zoom}
                </Badge>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Published</span>
                  <Switch
                    checked={dataset.is_published}
                    onCheckedChange={(next) => void togglePublish(dataset.id, next)}
                  />
                </div>
              </div>
            ))}
            {datasets.length === 0 && (
              <p className="text-sm text-muted-foreground">No datasets registered yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">Converting your own GeoTIFF</CardTitle>
            <CardDescription>
              Multi-gigabyte orthomosaics cannot be converted in a browser tab: the whole file would
              have to be decoded in memory, which exhausts the tab and crashes it. Convert on your own
              machine with the commands below, then upload the finished .pmtiles archive — a single
              file that streams tiles over HTTP range requests, so nothing has to be unpacked on the
              server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {GDAL_COMMANDS.map((step) => (
              <div key={step.label} className="space-y-1">
                <p className="text-xs text-muted-foreground">{step.label}</p>
                <div className="flex items-center gap-2 rounded border border-border bg-card/60 px-2 py-1.5">
                  <code className="readout min-w-0 flex-1 overflow-x-auto whitespace-pre text-[11px]">
                    {step.command}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => {
                      void navigator.clipboard.writeText(step.command);
                      toast.success("Command copied");
                    }}
                    aria-label="Copy command"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Cloudflare R2 has no egress fees, so a public bucket there is the cheapest way to serve
              large drone archives. Enable CORS for your app origin and keep the object publicly
              readable.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
