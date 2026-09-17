import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import { REVIEW_STATUSES, fetchCategories, fetchFeatures, fetchProfiles, qk } from "@/lib/data";
import { downloadShapefile, downloadText, toCsv, toGeoJson, toKml } from "@/lib/exporters";
import { fetchProjects, pk } from "@/lib/projects";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Export data — DroneTrace" },
      {
        name: "description",
        content:
          "Download verified digitizing results as Shapefile, GeoJSON, KML or CSV. Administrators only.",
      },
      { property: "og:title", content: "DroneTrace data export" },
      {
        property: "og:description",
        content: "Admin-only download of digitized features in WGS84.",
      },
    ],
  }),
  component: ExportPage,
});

function ExportPage() {
  const { user, isAdmin, loading } = useAuth();
  const [projectId, setProjectId] = useState<string>("");
  const [status, setStatus] = useState<string>("all");

  const projectsQuery = useQuery({
    queryKey: pk.projects,
    queryFn: fetchProjects,
    enabled: Boolean(user) && isAdmin,
  });
  const featuresQuery = useQuery({
    queryKey: qk.features(projectId),
    queryFn: () => fetchFeatures(projectId),
    enabled: Boolean(projectId) && isAdmin,
  });
  const categoriesQuery = useQuery({
    queryKey: qk.categories(projectId),
    queryFn: () => fetchCategories(projectId),
    enabled: Boolean(projectId) && isAdmin,
  });
  const profilesQuery = useQuery({
    queryKey: qk.profiles,
    queryFn: fetchProfiles,
    enabled: isAdmin,
  });

  if (!loading && !isAdmin) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          Only administrators can download digitized data.
        </p>
      </div>
    );
  }

  const projects = projectsQuery.data ?? [];
  const project = projects.find((item) => item.id === projectId) ?? null;
  const rows = (featuresQuery.data ?? []).filter(
    (row) => status === "all" || row.status === status,
  );
  const ctx = {
    categories: categoriesQuery.data ?? [],
    profiles: profilesQuery.data ?? [],
  };
  const slug = (project?.name ?? "dronetrace").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const run = async (format: "shp" | "geojson" | "kml" | "csv") => {
    if (rows.length === 0) {
      toast.error("Nothing to download with these filters");
      return;
    }
    try {
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
                ? `${rows.length} feature${rows.length === 1 ? "" : "s"} match these filters.`
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
              <Button disabled={!projectId} onClick={() => void run("shp")}>
                <Download className="mr-1.5 size-4" /> Shapefile (.zip)
              </Button>
              <Button variant="outline" disabled={!projectId} onClick={() => void run("geojson")}>
                GeoJSON
              </Button>
              <Button variant="outline" disabled={!projectId} onClick={() => void run("kml")}>
                KML
              </Button>
              <Button variant="outline" disabled={!projectId} onClick={() => void run("csv")}>
                CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
