import { useQuery } from "@tanstack/react-query";

import { fetchFeatureVersions, qk, reviewStatusLabel, type Profile } from "@/lib/data";

type Props = {
  featureId: string;
  profiles: Profile[];
};

function describe(kind: string): string {
  if (kind === "created") return "Created";
  if (kind === "baseline") return "Earliest saved state";
  if (kind === "geometry") return "Shape changed";
  if (kind === "attributes") return "Details changed";
  if (kind === "deleted") return "Removed";
  if (kind === "restored") return "Restored";
  if (kind.startsWith("status:")) {
    const [, change] = kind.split(":");
    const [from, to] = (change ?? "").split("->");
    return `Status ${reviewStatusLabel((from ?? "") as never)} to ${reviewStatusLabel(
      (to ?? "") as never,
    )}`;
  }
  return kind;
}

/** Saved history for one feature, newest first. */
export function FeatureHistory({ featureId, profiles }: Props) {
  const versionsQuery = useQuery({
    queryKey: qk.featureVersions(featureId),
    queryFn: () => fetchFeatureVersions(featureId),
  });
  const versions = versionsQuery.data ?? [];

  const nameOf = (id: string | null) => {
    if (!id) return "System";
    const profile = profiles.find((item) => item.id === id);
    return profile?.display_name ?? profile?.email ?? "Unknown";
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">History</p>
      {versions.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No saved history yet.</p>
      )}
      <ol className="space-y-1">
        {versions.map((version) => (
          <li
            key={version.id}
            className="rounded border border-border bg-card/60 px-2 py-1 text-[11px]"
          >
            <span className="font-medium text-foreground">v{version.version}</span>{" "}
            {describe(version.change_kind)}
            <span className="block text-muted-foreground">
              {new Date(version.created_at).toLocaleString()} · {nameOf(version.changed_by)}
            </span>
            {version.review_note && (
              <span className="block text-muted-foreground">Note: {version.review_note}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
