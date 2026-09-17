import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

const MapWorkspace = lazy(() => import("@/components/map/MapWorkspace"));

export const Route = createFileRoute("/p/$projectId/")({
  component: WorkspacePage,
});

function MapFallback() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading the map workspace…</p>
    </div>
  );
}

function WorkspacePage() {
  const { projectId } = Route.useParams();
  return (
    <ClientOnly fallback={<MapFallback />}>
      <Suspense fallback={<MapFallback />}>
        <MapWorkspace projectId={projectId} />
      </Suspense>
    </ClientOnly>
  );
}
