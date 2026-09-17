import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import type { SaveStatus } from "./types";
import { formatDecimalDegrees, formatDms, formatUtm, metresPerPixel, niceScale } from "@/lib/geo";
import { cn } from "@/lib/utils";

type Props = {
  cursor: { lng: number; lat: number } | null
  centreLat: number
  zoom: number
  featureCount: number
  saveStatus: SaveStatus
};

function ScaleBar({ lat, zoom }: { lat: number; zoom: number }) {
  const mpp = metresPerPixel(lat, zoom);
  const { metres, label } = niceScale(mpp * 120);
  const width = Math.max(28, Math.min(180, metres / mpp));
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-center">
        <span className="readout text-[10px] leading-none">{label}</span>
        <div
          className="mt-1 h-[6px] border-x-2 border-b-2 border-foreground/70"
          style={{ width: `${width}px` }}
        />
      </div>
    </div>
  );
}

export function StatusBar({ cursor, centreLat, zoom, featureCount, saveStatus }: Props) {
  const lng = cursor?.lng ?? 0;
  const lat = cursor?.lat ?? 0;

  return (
    <div className="flex h-9 shrink-0 items-center gap-4 overflow-x-auto border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
      <span className="readout shrink-0 rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
        EPSG:4326 stored · EPSG:3857 rendered
      </span>
      <span className="readout shrink-0">
        DD {cursor ? formatDecimalDegrees(lng, lat) : "—"}
      </span>
      <span className="readout hidden shrink-0 md:inline">
        DMS {cursor ? formatDms(lng, lat) : "—"}
      </span>
      <span className="readout hidden shrink-0 lg:inline">
        UTM {cursor ? formatUtm(lng, lat) : "—"}
      </span>
      <span className="readout shrink-0">z {zoom.toFixed(2)}</span>
      <div className="shrink-0">
        <ScaleBar lat={centreLat} zoom={zoom} />
      </div>
      <span className="readout shrink-0">{featureCount} features</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {saveStatus === "saving" && (
          <>
            <Loader2 className="size-3.5 animate-spin text-primary" />
            <span className="text-primary">Saving…</span>
          </>
        )}
        {saveStatus === "saved" && (
          <>
            <CheckCircle2 className="size-3.5 text-success" />
            <span className="text-success">Saved automatically</span>
          </>
        )}
        {saveStatus === "error" && (
          <>
            <TriangleAlert className="size-3.5 text-destructive" />
            <span className="text-destructive">Save failed — retrying on next edit</span>
          </>
        )}
        {saveStatus === "idle" && <span className={cn("text-muted-foreground")}>All changes stored</span>}
      </div>
    </div>
  );
}
