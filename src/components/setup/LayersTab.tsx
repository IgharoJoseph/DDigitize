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
  layerDisplay,
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
  const [defaultValue, setDefaultValue] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [maxLength, setMaxLength] = useState("");
  const [pattern, setPattern] = useState("");
  const [helpText, setHelpText] = useState("");
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
    if (pattern.trim()) {
      try {
        new RegExp(pattern.trim());
      } catch {
        toast.error("That validation pattern is not valid");
        return;
      }
    }
    const allowed =
      fieldType === "select"
        ? options
            .split(",")
            .map((option) => option.trim())
            .filter(Boolean)
            .slice(0, 30)
        : [];
    if (defaultValue.trim() && allowed.length > 0 && !allowed.includes(defaultValue.trim())) {
      toast.error("The default value must be one of the allowed values");
      return;
    }
    const numberOr = (value: string) => {
      const parsed = Number(value);
      return value.trim() !== "" && Number.isFinite(parsed) ? parsed : null;
    };
    const { error } = await supabase.from("category_fields").insert({
      category_id: category.id,
      key,
      label: trimmed.slice(0, 60),
      field_type: fieldType,
      options: allowed,
      required,
      default_value: defaultValue.trim() || null,
      min_value: fieldType === "number" ? numberOr(minValue) : null,
      max_value: fieldType === "number" ? numberOr(maxValue) : null,
      max_length: fieldType === "text" ? numberOr(maxLength) : null,
      pattern: fieldType === "text" ? pattern.trim() || null : null,
      help_text: helpText.trim() || null,
      sort_order: category.fields.length + 1,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setLabel("");
    setOptions("");
    setRequired(false);
    setDefaultValue("");
    setMinValue("");
    setMaxValue("");
    setMaxLength("");
    setPattern("");
    setHelpText("");
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

  /** Per-layer production rules used by the live checks and by the database. */
  const setRule = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from("feature_categories")
      .update(patch as never)
      .eq("id", category.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged();
  };

  const display = layerDisplay(category);
  const setDisplay = (patch: Partial<Record<string, unknown>>) =>
    void setRule({
      display_config: {
        fillOpacity: display.fillOpacity,
        lineWidth: display.lineWidth,
        labelField: display.labelField,
        minZoom: display.minZoom,
        ...patch,
      },
    });

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
        <div className="space-y-1.5">
          <Label className="text-xs">Description</Label>
          <Input
            className="h-8 text-xs"
            maxLength={300}
            defaultValue={category.description ?? ""}
            placeholder="What contributors should capture on this layer"
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next !== (category.description ?? ""))
                void setRule({ description: next || null });
            }}
          />
        </div>

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
            label="Must fall inside the project boundary"
            checked={category.require_within_project}
            onChange={(value) => void setRule({ require_within_project: value })}
          />
          <RuleSwitch
            label="Shapes may not cross themselves"
            checked={category.forbid_self_intersection}
            onChange={(value) => void setRule({ forbid_self_intersection: value })}
          />
          <RuleSwitch
            label="Block saving when a rule is broken (otherwise warn)"
            checked={category.overlap_severity === "error"}
            onChange={(value) => void setRule({ overlap_severity: value ? "error" : "warning" })}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <NumberSetting
              label="Max points per shape"
              value={category.max_vertices}
              min={3}
              max={200000}
              onCommit={(value) => void setRule({ max_vertices: value })}
            />
            <NumberSetting
              label="Max shape size (KB)"
              value={category.max_payload_kb}
              min={8}
              max={8192}
              onCommit={(value) => void setRule({ max_payload_kb: value })}
            />
          </div>
        </div>

        <div className="space-y-2 rounded border border-border bg-card/60 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Access &amp; display
          </p>
          <RuleSwitch
            label="Layer is in use"
            checked={category.is_active}
            onChange={(value) => void setRule({ is_active: value })}
          />
          <RuleSwitch
            label="Contributors can see this layer (prevents duplicate digitizing)"
            checked={category.visible_to_contributors}
            onChange={(value) => void setRule({ visible_to_contributors: value })}
          />
          <RuleSwitch
            label="Contributors may edit each other's features on this layer"
            checked={category.editable_by_peers}
            onChange={(value) => void setRule({ editable_by_peers: value })}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <NumberSetting
              label="Fill opacity"
              value={display.fillOpacity}
              min={0}
              max={1}
              step={0.05}
              onCommit={(value) => setDisplay({ fillOpacity: value })}
            />
            <NumberSetting
              label="Line width"
              value={display.lineWidth}
              min={0.5}
              max={8}
              step={0.5}
              onCommit={(value) => setDisplay({ lineWidth: value })}
            />
            <NumberSetting
              label="Draw from zoom"
              value={display.minZoom}
              min={0}
              max={22}
              onCommit={(value) => setDisplay({ minZoom: value })}
            />
            <div className="w-40 space-y-1">
              <Label className="text-[10px] text-muted-foreground">Label features with</Label>
              <Select
                value={display.labelField ?? "none"}
                onValueChange={(value) =>
                  setDisplay({ labelField: value === "none" ? null : value })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No labels</SelectItem>
                  {category.fields.map((field) => (
                    <SelectItem key={field.id} value={field.key}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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
          <div className="w-32 space-y-1">
            <Label className="text-xs">Default value</Label>
            <Input
              value={defaultValue}
              className="h-8 text-xs"
              maxLength={120}
              onChange={(event) => setDefaultValue(event.target.value)}
              placeholder={fieldType === "boolean" ? "true / false" : "optional"}
            />
          </div>
          {fieldType === "number" && (
            <>
              <div className="w-24 space-y-1">
                <Label className="text-xs">Min</Label>
                <Input
                  value={minValue}
                  type="number"
                  className="h-8 text-xs"
                  onChange={(event) => setMinValue(event.target.value)}
                />
              </div>
              <div className="w-24 space-y-1">
                <Label className="text-xs">Max</Label>
                <Input
                  value={maxValue}
                  type="number"
                  className="h-8 text-xs"
                  onChange={(event) => setMaxValue(event.target.value)}
                />
              </div>
            </>
          )}
          {fieldType === "text" && (
            <>
              <div className="w-28 space-y-1">
                <Label className="text-xs">Max characters</Label>
                <Input
                  value={maxLength}
                  type="number"
                  className="h-8 text-xs"
                  onChange={(event) => setMaxLength(event.target.value)}
                />
              </div>
              <div className="min-w-36 flex-1 space-y-1">
                <Label className="text-xs">Format rule (optional)</Label>
                <Input
                  value={pattern}
                  className="h-8 text-xs"
                  maxLength={120}
                  onChange={(event) => setPattern(event.target.value)}
                  placeholder="^[A-Z]{2}-[0-9]{4}$"
                />
              </div>
            </>
          )}
          <div className="min-w-36 flex-1 space-y-1">
            <Label className="text-xs">Help text</Label>
            <Input
              value={helpText}
              className="h-8 text-xs"
              maxLength={160}
              onChange={(event) => setHelpText(event.target.value)}
              placeholder="Shown under the field"
            />
          </div>
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

/** Small numeric setting that only writes once the person leaves the box. */
function NumberSetting({
  label,
  value,
  min,
  max,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="w-32 space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-8 text-xs"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        key={value}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          const clamped = Math.min(Math.max(next, min), max);
          if (clamped !== value) onCommit(clamped);
        }}
      />
    </div>
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
