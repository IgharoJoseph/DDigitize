import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  createFeature,
  fetchCategories,
  qk,
  type CategoryWithFields,
  type FieldType,
  type GeomType,
} from "@/lib/data";
import { geometryArea, geometryLength, isValidGeometry } from "@/lib/geo";

const GEOM_OPTIONS: { value: GeomType; label: string }[] = [
  { value: "polygon", label: "Polygon" },
  { value: "line", label: "Line" },
  { value: "point", label: "Point" },
];

const FIELD_OPTIONS: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "select", label: "Dropdown" },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function LayersTab({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({
    queryKey: qk.categories(projectId),
    queryFn: () => fetchCategories(projectId),
  });
  const categories = categoriesQuery.data ?? [];

  const [name, setName] = useState("");
  const [geometryType, setGeometryType] = useState<GeomType>("polygon");
  const [color, setColor] = useState("#38bdf8");

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.categories(projectId) });

  const addCategory = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (trimmed.length < 2) throw new Error("Give the category a name");
      const { error } = await supabase.from("feature_categories").insert({
        project_id: projectId,
        name: trimmed.slice(0, 60),
        geometry_type: geometryType,
        color,
        sort_order: categories.length + 1,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setName("");
      void refresh();
      toast.success("Category added");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not add category"),
  });

  return (
    <div className="space-y-6">
      <div>
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Feature layers &amp; attributes
          </h2>
          <p className="text-sm text-muted-foreground">
            Contributors can only fill in the fields you define here, so every record comes back in
            the same shape.
          </p>
        </div>

        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className="text-base">New category</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="cat-name">Name</Label>
              <Input
                id="cat-name"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                placeholder="Residential Building"
              />
            </div>
            <div className="w-40 space-y-1.5">
              <Label>Geometry</Label>
              <Select
                value={geometryType}
                onValueChange={(value) => setGeometryType(value as GeomType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEOM_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28 space-y-1.5">
              <Label htmlFor="cat-color">Colour</Label>
              <Input
                id="cat-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-9 p-1"
              />
            </div>
            <Button onClick={() => addCategory.mutate()} disabled={addCategory.isPending}>
              <Plus className="mr-1.5 size-4" /> Add category
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              onChanged={refresh}
              userId={user?.id ?? null}
              projectId={projectId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryCard({
  category,
  onChanged,
  userId,
  projectId,
}: {
  category: CategoryWithFields;
  onChanged: () => void;
  userId: string | null;
  projectId: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [uploading, setUploading] = useState(false);

  const addField = async () => {
    const trimmed = label.trim();
    if (trimmed.length < 2) {
      toast.error("Give the field a label");
      return;
    }
    const key = slugify(trimmed);
    if (!key) {
      toast.error("Use letters or numbers in the label");
      return;
    }
    const { error } = await supabase.from("category_fields").insert({
      category_id: category.id,
      key,
      label: trimmed.slice(0, 60),
      field_type: fieldType,
      options:
        fieldType === "select"
          ? options
              .split(",")
              .map((option) => option.trim())
              .filter(Boolean)
              .slice(0, 30)
          : [],
      required,
      sort_order: category.fields.length + 1,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setLabel("");
    setOptions("");
    setRequired(false);
    onChanged();
  };

  const removeField = async (id: string) => {
    const { error } = await supabase.from("category_fields").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged();
  };

  /** Per-layer production rules used by the live checks while digitising. */
  const setRule = async (patch: {
    check_duplicates?: boolean;
    allow_overlap?: boolean;
    require_within_area?: boolean;
    overlap_severity?: string;
  }) => {
    const { error } = await supabase.from("feature_categories").update(patch).eq("id", category.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged();
  };

  const removeCategory = async () => {
    const { error } = await supabase.from("feature_categories").delete().eq("id", category.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged();
  };

  /** Uploads an empty feature set or grid so contributors start from prepared shapes. */
  const uploadGeoJson = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        type?: string;
        features?: { geometry?: unknown; properties?: Record<string, unknown> }[];
        geometry?: unknown;
      };
      const items =
        parsed.type === "FeatureCollection" && Array.isArray(parsed.features)
          ? parsed.features
          : [parsed as { geometry?: unknown }];

      let added = 0;
      let skipped = 0;
      for (const item of items.slice(0, 500)) {
        const geometry = item.geometry;
        if (!isValidGeometry(geometry)) {
          skipped += 1;
          continue;
        }
        const typed = geometry as Parameters<typeof geometryArea>[0];
        await createFeature({
          projectId,
          workAreaId: null,
          categoryId: category.id,
          datasetId: null,
          geometry: typed,
          attributes: {},
          areaSqm: geometryArea(typed),
          lengthM: geometryLength(typed),
          createdBy: userId,
        });
        added += 1;
      }
      toast.success(
        `Imported ${added} shape${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} with invalid coordinates` : ""}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Could not read that file: ${error.message}`
          : "Could not read that file",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card className="bg-panel">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <span className="size-3 rounded-sm" style={{ backgroundColor: category.color }} />
        <div>
          <CardTitle className="text-base">{category.name}</CardTitle>
          <CardDescription className="text-xs">
            {category.geometry_type} · {category.fields.length} field
            {category.fields.length === 1 ? "" : "s"}
          </CardDescription>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadGeoJson(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1.5 size-3.5" /> Upload GeoJSON
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-destructive"
            onClick={() => void removeCategory()}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 rounded border border-border bg-card/60 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Validation rules
          </p>
          <RuleSwitch
            label="Warn about possible duplicates"
            checked={category.check_duplicates}
            onChange={(value) => void setRule({ check_duplicates: value })}
          />
          <RuleSwitch
            label="Allow features to overlap"
            checked={category.allow_overlap}
            onChange={(value) => void setRule({ allow_overlap: value })}
          />
          <RuleSwitch
            label="Must fall inside a work area"
            checked={category.require_within_area}
            onChange={(value) => void setRule({ require_within_area: value })}
          />
          <RuleSwitch
            label="Block saving when a rule is broken (otherwise warn)"
            checked={category.overlap_severity === "error"}
            onChange={(value) => void setRule({ overlap_severity: value ? "error" : "warning" })}
          />
        </div>

        <ul className="space-y-1">
          {category.fields.map((field) => (
            <li
              key={field.id}
              className="flex items-center gap-2 rounded border border-border bg-card/60 px-2 py-1.5 text-xs"
            >
              <span className="font-medium">{field.label}</span>
              <span className="readout text-[10px] text-muted-foreground">{field.key}</span>
              <Badge variant="outline" className="text-[9px] uppercase">
                {field.field_type}
              </Badge>
              {field.required && <Badge className="text-[9px] uppercase">required</Badge>}
              {field.options.length > 0 && (
                <span className="truncate text-[10px] text-muted-foreground">
                  {field.options.join(" · ")}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 text-destructive"
                onClick={() => void removeField(field.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
          {category.fields.length === 0 && (
            <li className="text-xs text-muted-foreground">No attribute fields yet.</li>
          )}
        </ul>

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="min-w-36 flex-1 space-y-1">
            <Label className="text-xs">Field label</Label>
            <Input
              value={label}
              maxLength={60}
              className="h-8 text-xs"
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Roof material"
            />
          </div>
          <div className="w-32 space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={fieldType} onValueChange={(value) => setFieldType(value as FieldType)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fieldType === "select" && (
            <div className="min-w-40 flex-1 space-y-1">
              <Label className="text-xs">Options (comma separated)</Label>
              <Input
                value={options}
                className="h-8 text-xs"
                maxLength={400}
                onChange={(event) => setOptions(event.target.value)}
                placeholder="Metal, Tile, Thatch"
              />
            </div>
          )}
          <div className="flex items-center gap-2 pb-1.5">
            <Switch checked={required} onCheckedChange={setRequired} />
            <span className="text-xs text-muted-foreground">Required</span>
          </div>
          <Button size="sm" onClick={() => void addField()}>
            <Plus className="mr-1.5 size-3.5" /> Add field
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-muted-foreground">{label}</span>
    </label>
  );
}
