import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { REVIEW_STATUSES } from "@/lib/data";
import { downloadShapefile, downloadText, toCsv, toGeoJson, toKml } from "@/lib/exporters";
import { buildProjectExport } from "@/lib/exports.functions";
import { fetchProjects, pk } from "@/lib/projects";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Export data — DDigitize" },
      {
        name: "description",
        content:
          "Download verified digitizing results as Shapefile, GeoJSON, KML or CSV. Administrators only.",
      },
      { property: "og:title", content: "DDigitize data export" },
      {
        property: "og:description",
        content: "Admin-only download of digitized features in WGS84.",
      },
    ],
  }),
  component: ExportPage,
});

function ExportPage() {
  const { user, isAdmin, isManager, loading } = useAuth();
  // Platform administrators, organisation managers and project owners may
  // export. The server checks the permission again per project.
  const mayReachExports = isAdmin || isManager;
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const requestExport = useServerFn(buildProjectExport);

  const projectsQuery = useQuery({
    queryKey: pk.projects,
    queryFn: fetchProjects,
    enabled: Boolean(user) && mayReachExports,
  });

  if (!loading && !mayReachExports) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          You do not have permission to download digitized data.
        </p>
      </div>
    );
  }

  const projects = projectsQuery.data ?? [];
  const project = projects.find((item) => item.id === projectId) ?? null;
  const slug = (project?.name ?? "ddigitize").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // The payload is assembled on the server, which checks administrator
  // authority itself and records the download in the audit trail.
  const run = async (format: "shp" | "geojson" | "kml" | "csv") => {
    if (!projectId) return;
    setBusy(true);
    try {
      const payload = await requestExport({ data: { projectId, status } });
      const rows = payload.features;
      if (rows.length === 0) {
        toast.error("Nothing to download with these filters");
        return;
      }
      const ctx = { categories: payload.categories, profiles: payload.profiles };
      if (format === "geojson") {
        downloadText(`${slug}.geojson`, "application/geo+json", toGeoJson(rows, ctx));
      } else if (format === "kml") {
        downloadText(`${slug}.kml`, "application/vnd.google-earth.kml+xml", toKml(rows, ctx));
      } else if (format === "csv") {
        downloadText(`${slug}.csv`, "text/csv", toCsv(rows, ctx));
      } else {
        await downloadShapefile(rows, ctx, `${slug}-shapefile.zip`);
      }
      toast.success(`${rows.length} features exported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Export data</h1>
          <p className="text-sm text-muted-foreground">
            Downloads are restricted to administrators. Everything is exported in WGS84 (longitude,
            latitude).
          </p>
        </div>

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">Choose what to download</CardTitle>
            <CardDescription>
              {projectId
                ? "Pick a format — the file is prepared on the server and the download is recorded."
                : "Pick a project first."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Project</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Review status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everything</SelectItem>
                    {REVIEW_STATUSES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={!projectId || busy} onClick={() => void run("shp")}>
                <Download className="mr-1.5 size-4" /> Shapefile (.zip)
              </Button>
              <Button
                variant="outline"
                disabled={!projectId || busy}
                onClick={() => void run("geojson")}
              >
                GeoJSON
              </Button>
              <Button
                variant="outline"
                disabled={!projectId || busy}
                onClick={() => void run("kml")}
              >
                KML
              </Button>
              <Button
                variant="outline"
                disabled={!projectId || busy}
                onClick={() => void run("csv")}
              >
                CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
