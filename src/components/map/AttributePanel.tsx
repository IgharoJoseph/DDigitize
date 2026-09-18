import { Crosshair, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { Attributes, CategoryWithFields, FeatureRow, FeaturePatch, Profile } from "@/lib/data";
import { CommentsSection } from "./CommentsSection";
import { FeatureHistory } from "./FeatureHistory";
import { featureAttributes, reviewStatusLabel } from "@/lib/data";
import {
  formatArea,
  formatDecimalDegrees,
  formatLength,
  geometryCentre,
  safeLngLat,
} from "@/lib/geo";
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
  feature: FeatureRow;
  categories: CategoryWithFields[];
  profiles: Profile[];
  canEdit: boolean;
  /** Managers, supervisors and admins may verify work or send it back. */
  canReview: boolean;
  workAreas: WorkArea[];
  onPatch: (patch: FeaturePatch) => void;
  onDelete: () => void;
  onClose: () => void;
  onZoom: () => void;
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
  const [note, setNote] = useState(feature.review_note ?? "");
  const category = categories.find((item) => item.id === feature.category_id) ?? null;

  useEffect(() => {
    setDraft(featureAttributes(feature));
    setNote(feature.review_note ?? "");
  }, [feature.id, feature.updated_at, feature.review_note]);

  const setValue = (key: string, value: string | number | boolean | null) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onPatch({ attributes: next });
  };

  const geometry = feature.geometry as unknown as Parameters<typeof geometryCentre>[0];
  const centre = safeLngLat(...geometryCentre(geometry)) ?? [0, 0];
  const creator = profiles.find((item) => item.id === feature.created_by) ?? null;
  const creatorName = creator?.display_name ?? creator?.email ?? "Unknown";
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
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={onZoom}
          aria-label="Zoom to feature"
        >
          <Crosshair className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          aria-label="Close attributes"
        >
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
            <dt>Digitized by</dt>
            <dd className="text-foreground">{creatorName}</dd>
            <dt>Created</dt>
            <dd className="text-foreground">{new Date(feature.created_at).toLocaleString()}</dd>
            <dt>Updated</dt>
            <dd className="text-foreground">{new Date(feature.updated_at).toLocaleString()}</dd>
            <dt>Version</dt>
            <dd className="text-foreground">{feature.version ?? 1}</dd>
          </dl>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Category
            </Label>
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
                      maxLength={field.max_length ?? 240}
                      value={value === null || value === undefined ? "" : String(value)}
                      onChange={(event) => setValue(field.key, event.target.value)}
                    />
                  )}

                  {field.field_type === "number" && (
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      disabled={!canEdit}
                      {...(field.min_value === null ? {} : { min: Number(field.min_value) })}
                      {...(field.max_value === null ? {} : { max: Number(field.max_value) })}
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

                  {/* Guidance and the accepted range, as configured on the layer. */}
                  {field.help_text && (
                    <p className="text-[10px] text-muted-foreground">{field.help_text}</p>
                  )}
                  {field.field_type === "number" &&
                    (field.min_value !== null || field.max_value !== null) && (
                      <p className="text-[10px] text-muted-foreground">
                        Allowed range: {field.min_value ?? "any"} to {field.max_value ?? "any"}
                      </p>
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

          {/* Workflow: draft -> submitted -> under review -> approved, with a
              correction loop. The steps follow the same order the database
              enforces, so the buttons can never offer an invalid move. */}
          <div className="space-y-2 rounded border border-border bg-card/60 p-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Workflow
              </Label>
              <span className="text-xs font-medium text-foreground">
                {reviewStatusLabel(feature.status)}
              </span>
            </div>

            {canReview && (
              <Textarea
                className="min-h-16 text-xs"
                maxLength={600}
                placeholder="Note for the person who digitized this"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}

            {!canReview && feature.review_note && (
              <p className="text-[11px] text-muted-foreground">
                Reviewer note: {feature.review_note}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {canEdit && (feature.status === "draft" || feature.status === "needs_revision") && (
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={missingRequired.length > 0}
                  onClick={() => onPatch({ status: "submitted" })}
                >
                  Submit for review
                </Button>
              )}

              {canEdit && !canReview && feature.status === "submitted" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => onPatch({ status: "draft" })}
                >
                  Withdraw to draft
                </Button>
              )}

              {canReview && feature.status === "submitted" && (
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => onPatch({ status: "under_review" })}
                >
                  Start review
                </Button>
              )}

              {canReview && feature.status === "under_review" && (
                <>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      onPatch({ status: "verified", ...(note.trim() ? { reviewNote: note } : {}) })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={note.trim().length < 3}
                    onClick={() => onPatch({ status: "needs_revision", reviewNote: note.trim() })}
                  >
                    Request changes
                  </Button>
                </>
              )}

              {canReview && feature.status === "verified" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => onPatch({ status: "under_review" })}
                >
                  Reopen for revision
                </Button>
              )}
            </div>

            {feature.status === "submitted" && !canReview && (
              <p className="text-[11px] text-muted-foreground">
                Submitted and waiting for a reviewer.
              </p>
            )}
          </div>

          <FeatureHistory featureId={feature.id} profiles={profiles} />

          <CommentsSection
            projectId={feature.project_id ?? ""}
            featureId={feature.id}
            profiles={profiles}
            canResolve={canReview}
          />

          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-1.5 size-3.5" /> Remove feature
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
