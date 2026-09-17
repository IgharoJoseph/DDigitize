import { Crosshair, Layers } from "lucide-react";

import { BASEMAPS, type BasemapId } from "@/lib/basemaps";
import type { ImageryDataset } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type Props = {
  basemap: BasemapId;
  onBasemap: (id: BasemapId) => void;
  datasets: ImageryDataset[];
  datasetId: string | null;
  onDataset: (id: string | null) => void;
  opacity: number;
  onOpacity: (value: number) => void;
  imageryVisible: boolean;
  onImageryVisible: (value: boolean) => void;
  loading?: boolean;
  onZoomToImagery?: () => void;
};

export function BasemapPanel({
  basemap,
  onBasemap,
  datasets,
  datasetId,
  onDataset,
  opacity,
  onOpacity,
  imageryVisible,
  onImageryVisible,
  loading,
  onZoomToImagery,
}: Props) {

  const dataset = datasets.find((item) => item.id === datasetId) ?? null;

  return (
    <div className="space-y-4 p-3">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          <Layers className="size-3.5" /> Basemap
        </Label>
        <div className="grid grid-cols-2 gap-1.5">
          {BASEMAPS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onBasemap(item.id)}
              className={
                basemap === item.id
                  ? "rounded border border-primary bg-primary/15 px-2 py-1.5 text-xs font-medium text-foreground"
                  : "rounded border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Drone imagery
        </Label>
        <Select
          value={datasetId ?? "none"}
          onValueChange={(value) => onDataset(value === "none" ? null : value)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select a dataset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No imagery (basemap only)</SelectItem>
            {datasets.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {dataset && (
          <dl className="readout grid grid-cols-2 gap-x-2 gap-y-1 rounded border border-border bg-card/60 p-2 text-[10px] text-muted-foreground">
            <dt>GSD</dt>
            <dd className="text-foreground">{dataset.gsd_cm ? `${dataset.gsd_cm} cm/px` : "—"}</dd>
            <dt>Flown</dt>
            <dd className="text-foreground">{dataset.flight_date ?? "—"}</dd>
            <dt>Zoom</dt>
            <dd className="text-foreground">
              {dataset.min_zoom}–{dataset.max_zoom}
            </dd>
          </dl>
        )}

        {datasets.length === 0 && (
          <p className="rounded border border-border bg-card/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
            No imagery is registered for this project yet. Add a PMTiles dataset under Set up →
            Imagery, or use one of the samples listed there.
          </p>
        )}

        {dataset && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 flex-1 text-xs"
              onClick={onZoomToImagery}
            >
              <Crosshair className="mr-1 size-3.5" /> Zoom to imagery
            </Button>
            {loading && <span className="text-[10px] text-muted-foreground">Streaming…</span>}
          </div>
        )}



        <div className="flex items-center justify-between rounded border border-border bg-card/60 px-2 py-1.5">
          <span className="text-xs text-muted-foreground">Show imagery</span>
          <Switch checked={imageryVisible} onCheckedChange={onImageryVisible} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Imagery opacity</span>
            <span className="readout text-foreground">{Math.round(opacity * 100)}%</span>
          </div>
          <Slider
            value={[opacity * 100]}
            min={0}
            max={100}
            step={1}
            onValueChange={([value]) => onOpacity((value ?? 100) / 100)}
          />
        </div>
      </div>
    </div>
  );
}
