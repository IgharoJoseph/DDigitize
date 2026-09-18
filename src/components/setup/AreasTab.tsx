import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Grid3x3, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Polygon } from "geojson";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useProjectAreas } from "@/hooks/useProjectRole";
import { safeBounds } from "@/lib/geo";
import {
  AREA_STATUSES,
  areaBoundary,
  fetchAssignmentHistory,
  createWorkArea,
  deleteWorkArea,
  gridAreas,
  pk,
  updateWorkArea,
  type AreaStatus,
} from "@/lib/projects";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Work areas split the project so each contributor gets their own patch of ground. */
export function AreasTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const areasQuery = useProjectAreas(projectId);
  const areas = areasQuery.data ?? [];
  const historyQuery = useQuery({
    queryKey: pk.assignmentHistory(projectId),
    queryFn: () => fetchAssignmentHistory(projectId),
  });
  const history = historyQuery.data ?? [];
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState({
    west: "",
    south: "",
    east: "",
    north: "",
    cols: "2",
    rows: "2",
    prefix: "Cell",
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: pk.areas(projectId) });

  const uploadBoundaries = async (file: File) => {
    if (!user) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as {
        type?: string;
        features?: { geometry?: unknown; properties?: Record<string, unknown> }[];
        geometry?: unknown;
        properties?: Record<string, unknown>;
      };
      const items =
        parsed.type === "FeatureCollection" && Array.isArray(parsed.features)
          ? parsed.features
          : [parsed];

      let added = 0;
      let skipped = 0;
      for (const [index, item] of items.slice(0, 200).entries()) {
        const geometry = item.geometry as Polygon | undefined;
        if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
          skipped += 1;
          continue;
        }
        const label =
          (item.properties?.["name"] as string | undefined) ??
          (item.properties?.["Name"] as string | undefined) ??
          `Area ${areas.length + index + 1}`;
        await createWorkArea({
          projectId,
          name: String(label).slice(0, 60),
          boundary: geometry,
          createdBy: user.id,
        });
        added += 1;
      }
      toast.success(
        `Added ${added} work area${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} shape(s) that were not polygons` : ""}.`,
      );
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const makeGrid = async () => {
    if (!user) return;
    const bounds = safeBounds({
      west: Number(grid.west),
      south: Number(grid.south),
      east: Number(grid.east),
      north: Number(grid.north),
    });
    if (!bounds) {
      toast.error("Enter a valid box: longitudes -180 to 180 and latitudes -90 to 90");
      return;
    }
    const cols = Math.min(10, Math.max(1, Number(grid.cols) || 1));
    const rows = Math.min(10, Math.max(1, Number(grid.rows) || 1));
    setBusy(true);
    try {
      for (const cell of gridAreas(bounds, cols, rows, grid.prefix.trim() || "Cell")) {
        await createWorkArea({
          projectId,
          name: cell.name,
          boundary: cell.boundary,
          createdBy: user.id,
        });
      }
      toast.success(`Created ${cols * rows} work areas`);
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the grid");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteWorkArea(id);
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that area");
    }
  };

  const setStatus = async (id: string, status: AreaStatus) => {
    try {
      await updateWorkArea(id, { status });
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update that area");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Work areas</h2>
        <p className="text-sm text-muted-foreground">
          Contributors can only digitize inside the areas you assign to them, so nobody works over
          the same ground twice.
        </p>
      </div>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">Add areas</CardTitle>
          <CardDescription>
            Upload polygon boundaries, or cut a rectangular grid out of a bounding box. Coordinates
            are longitude / latitude in WGS84.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadBoundaries(file);
              }}
            />
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1.5 size-4" /> Upload boundaries (GeoJSON)
            </Button>
          </div>

          <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-4">
            {(
              [
                ["west", "West longitude"],
                ["south", "South latitude"],
                ["east", "East longitude"],
                ["north", "North latitude"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  className="h-8 text-xs"
                  value={grid[key]}
                  onChange={(event) =>
                    setGrid((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Columns</Label>
              <Input
                className="h-8 text-xs"
                type="number"
                min={1}
                max={10}
                value={grid.cols}
                onChange={(event) => setGrid((c) => ({ ...c, cols: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rows</Label>
              <Input
                className="h-8 text-xs"
                type="number"
                min={1}
                max={10}
                value={grid.rows}
                onChange={(event) => setGrid((c) => ({ ...c, rows: event.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Name prefix</Label>
              <Input
                className="h-8 text-xs"
                maxLength={20}
                value={grid.prefix}
                onChange={(event) => setGrid((c) => ({ ...c, prefix: event.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <Button size="sm" disabled={busy} onClick={() => void makeGrid()}>
                <Grid3x3 className="mr-1.5 size-3.5" /> Generate grid
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">
            {areas.length} area{areas.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {areas.map((area) => {
            const ring = areaBoundary(area)?.coordinates?.[0] ?? [];
            return (
              <div
                key={area.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{area.name}</p>
                  <p className="readout text-[10px] text-muted-foreground">
                    {ring.length} boundary points · updated{" "}
                    {new Date(area.updated_at ?? area.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant="outline" className="text-[9px] uppercase">
                  {area.status.replace("_", " ")}
                </Badge>
                <Select
                  value={area.status}
                  onValueChange={(value) => void setStatus(area.id, value as AreaStatus)}
                >
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AREA_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  onClick={() => void remove(area.id)}
                  aria-label="Delete work area"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            );
          })}
          {areas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No work areas yet. Contributors need at least one before they can digitize.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">Assignment history</CardTitle>
          <CardDescription>
            Every time an area is handed to someone or taken back, the database records it here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {history.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/60 px-3 py-1.5 text-xs"
            >
              <Badge variant="outline" className="text-[9px] uppercase">
                {row.action}
              </Badge>
              <span className="truncate">
                {areas.find((area) => area.id === row.work_area_id)?.name ?? "Deleted area"}
              </span>
              <span className="readout ml-auto text-[10px] text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {history.length === 0 && (
            <p className="text-sm text-muted-foreground">No assignments recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
