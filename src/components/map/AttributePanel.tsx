import { Crosshair, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  Attributes,
  CategoryWithFields,
  FeatureRow,
  FeaturePatch,
  Profile,
  ReviewStatus,
} from "@/lib/data";
import { CommentsSection } from "./CommentsSection";
import { REVIEW_STATUSES, featureAttributes } from "@/lib/data";
import { formatArea, formatDecimalDegrees, formatLength, geometryCentre, safeLngLat } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { WorkArea } from "@/lib/projects";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  feature: FeatureRow
  categories: CategoryWithFields[]
  profiles: Profile[]
  canEdit: boolean
  /** Managers, supervisors and admins may verify work or send it back. */
  canReview: boolean
  workAreas: WorkArea[]
  onPatch: (patch: FeaturePatch) => void
  onDelete: () => void
  onClose: () => void
  onZoom: () => void
};

export function AttributePanel({
  feature,
  categories,
  profiles,
  canEdit,
  canReview,
  workAreas,
  onPatch,
  onDelete,
  onClose,
  onZoom,
}: Props) {
  const [draft, setDraft] = useState<Attributes>(featureAttributes(feature));
  const category = categories.find((item) => item.id === feature.category_id) ?? null;

  useEffect(() => {
    setDraft(featureAttributes(feature));
  }, [feature.id, feature.updated_at]);

  const setValue = (key: string, value: string | number | boolean | null) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onPatch({ attributes: next });
  };

  const geometry = feature.geometry as unknown as Parameters<typeof geometryCentre>[0];
  const centre = safeLngLat(...geometryCentre(geometry)) ?? [0, 0];
  const missingRequired = (category?.fields ?? []).filter((field) => {
    if (!field.required) return false;
    const value = draft[field.key];
    return value === undefined || value === null || value === "";
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span
          className="size-2.5 rounded-sm"
          style={{ backgroundColor: category?.color ?? "#94a3b8" }}
        />
        <h2 className="truncate text-sm font-semibold">{category?.name ?? "Uncategorised"}</h2>
        <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={onZoom} aria-label="Zoom to feature">
          <Crosshair className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close attributes">
          <X className="size-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <dl className="readout grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded border border-border bg-card/60 p-2 text-[10px] text-muted-foreground">
            <dt>Centre</dt>
            <dd className="text-foreground">{formatDecimalDegrees(centre[0], centre[1])}</dd>
            <dt>Area</dt>
            <dd className="text-foreground">{formatArea(Number(feature.area_sqm))}</dd>
            <dt>Length</dt>
            <dd className="text-foreground">{formatLength(Number(feature.length_m))}</dd>
            <dt>Work area</dt>
            <dd className="text-foreground">
              {workAreas.find((area) => area.id === feature.work_area_id)?.name ?? "—"}
            </dd>
            <dt>Updated</dt>
            <dd className="text-foreground">{new Date(feature.updated_at).toLocaleString()}</dd>
          </dl>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Category</Label>
            <Select
              value={feature.category_id ?? ""}
              disabled={!canEdit}
              onValueChange={(value) => onPatch({ categoryId: value })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Standard attributes
            </Label>
            {(category?.fields ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">
                This category has no attribute fields defined yet.
              </p>
            )}
            {(category?.fields ?? []).map((field) => {
              const value = draft[field.key];
              return (
                <div key={field.id} className="space-y-1">
                  <Label className="text-xs">
                    {field.label}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>

                  {field.field_type === "text" && (
                    <Input
                      className="h-8 text-xs"
                      disabled={!canEdit}
                      maxLength={240}
                      value={value === null || value === undefined ? "" : String(value)}
                      onChange={(event) => setValue(field.key, event.target.value)}
                    />
                  )}

                  {field.field_type === "number" && (
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      disabled={!canEdit}
                      value={value === null || value === undefined ? "" : String(value)}
                      onChange={(event) =>
                        setValue(
                          field.key,
                          event.target.value === "" ? null : Number(event.target.value),
                        )
                      }
                    />
                  )}

                  {field.field_type === "boolean" && (
                    <div className="flex h-8 items-center">
                      <Switch
                        checked={value === true}
                        disabled={!canEdit}
                        onCheckedChange={(checked) => setValue(field.key, checked)}
                      />
                    </div>
                  )}

                  {field.field_type === "select" && (
                    <Select
                      value={value === null || value === undefined ? "" : String(value)}
                      disabled={!canEdit}
                      onValueChange={(next) => setValue(field.key, next)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>

          {missingRequired.length > 0 && (
            <p className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning-foreground dark:text-warning">
              Still required: {missingRequired.map((field) => field.label).join(", ")}
            </p>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Review status
            </Label>
            <Select
              value={feature.status}
              disabled={!canEdit}
              onValueChange={(value) => onPatch({ status: value as ReviewStatus })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVIEW_STATUSES.map((status) => (
                  <SelectItem
                    key={status.value}
                    value={status.value}
                    disabled={
                      !canReview &&
                      (status.value === "verified" || status.value === "needs_revision")
                    }
                  >
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {canReview && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Reviewer note
              </Label>
              <Textarea
                className="min-h-16 text-xs"
                maxLength={600}
                defaultValue={feature.review_note ?? ""}
                onBlur={(event) => onPatch({ reviewNote: event.target.value })}
              />
            </div>
          )}

          {!canReview && feature.review_note && (
            <p className="rounded border border-border bg-card/60 p-2 text-[11px] text-muted-foreground">
              Reviewer note: {feature.review_note}
            </p>
          )}

          {canEdit && (feature.status === "draft" || feature.status === "needs_revision") && (
            <Button
              size="sm"
              className="w-full"
              disabled={missingRequired.length > 0}
              onClick={() => onPatch({ status: "submitted" })}
            >
              Submit for review
            </Button>
          )}

          <CommentsSection
            projectId={feature.project_id ?? ""}
            featureId={feature.id}
            profiles={profiles}
            canResolve={canReview}
          />

          {canEdit && (
            <Button variant="outline" size="sm" className="w-full text-destructive" onClick={onDelete}>
              <Trash2 className="mr-1.5 size-3.5" /> Delete feature
            </Button>
          )}

          {!canEdit && (
            <p className="text-[11px] text-muted-foreground">
              {feature.status === "verified"
                ? "This feature is approved, so it is locked for editing."
                : "This feature is outside what you may edit, so it is read-only for you."}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
