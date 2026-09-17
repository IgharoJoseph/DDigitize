import { Eye, EyeOff, Search } from "lucide-react";

import type { CategoryWithFields, FeatureRow, Profile } from "@/lib/data";
import { formatArea, formatLength } from "@/lib/geo";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  categories: CategoryWithFields[];
  features: FeatureRow[];
  profiles: Profile[];
  hidden: Set<string>;
  onToggleCategory: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  contributorFilter: string;
  onContributorFilter: (value: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function LayersPanel({
  categories,
  features,
  profiles,
  hidden,
  onToggleCategory,
  search,
  onSearch,
  contributorFilter,
  onContributorFilter,
  selectedId,
  onSelect,
}: Props) {
  const contributorName = (id: string | null) => {
    const profile = profiles.find((item) => item.id === id);
    return profile?.display_name ?? profile?.email ?? "Unknown";
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Feature layers
        </Label>
        <div className="space-y-1">
          {categories.map((category) => {
            const count = features.filter((f) => f.category_id === category.id).length;
            const isHidden = hidden.has(category.id);
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onToggleCategory(category.id)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-secondary"
              >
                {isHidden ? (
                  <EyeOff className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Eye className="size-3.5 shrink-0 text-primary" />
                )}
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: category.color }}
                />
                <span className={isHidden ? "truncate text-muted-foreground" : "truncate"}>
                  {category.name}
                </span>
                <span className="readout ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {count}
                </span>
              </button>
            );
          })}
          {categories.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No categories yet. An admin defines them in the template builder.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search features"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Select value={contributorFilter} onValueChange={onContributorFilter}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="All contributors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contributors</SelectItem>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.display_name ?? profile.email ?? "Unknown"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
        <ul className="space-y-1 pb-2">
          {features.map((feature) => {
            const category = categories.find((c) => c.id === feature.category_id);
            const measure =
              Number(feature.area_sqm) > 0
                ? formatArea(Number(feature.area_sqm))
                : Number(feature.length_m) > 0
                  ? formatLength(Number(feature.length_m))
                  : "point";
            return (
              <li key={feature.id}>
                <button
                  type="button"
                  onClick={() => onSelect(feature.id)}
                  className={
                    selectedId === feature.id
                      ? "w-full rounded border border-primary bg-primary/10 px-2 py-1.5 text-left"
                      : "w-full rounded border border-transparent px-2 py-1.5 text-left hover:bg-secondary"
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: category?.color ?? "#94a3b8" }}
                    />
                    <span className="truncate text-xs font-medium">
                      {category?.name ?? "Uncategorised"}
                    </span>
                    <Badge variant="outline" className="ml-auto shrink-0 text-[9px] uppercase">
                      {feature.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="readout mt-0.5 truncate text-[10px] text-muted-foreground">
                    {measure} · {contributorName(feature.created_by)}
                  </p>
                </button>
              </li>
            );
          })}
          {features.length === 0 && (
            <li className="px-2 py-4 text-xs text-muted-foreground">
              Nothing matches this filter yet.
            </li>
          )}
        </ul>
      </ScrollArea>
    </div>
  );
}
