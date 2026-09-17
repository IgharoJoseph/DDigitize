import {
  Hand,
  MapPin,
  MousePointer2,
  Pentagon,
  Redo2,
  Slash,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Tool } from "./types";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  tool: Tool;
  onTool: (tool: Tool) => void;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  canDelete: boolean;
};

const TOOLS: { id: Tool; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "pan", label: "Pan", icon: Hand, hint: "Pan and inspect imagery" },
  {
    id: "select",
    label: "Select / edit",
    icon: MousePointer2,
    hint: "Select, drag vertices, delete vertices",
  },
  { id: "polygon", label: "Polygon", icon: Pentagon, hint: "Trace buildings and parcels" },
  { id: "rectangle", label: "Rectangle", icon: Square, hint: "Quick rectangular footprints" },
  { id: "linestring", label: "Line", icon: Slash, hint: "Roads, waterways, powerlines" },
  { id: "point", label: "Point", icon: MapPin, hint: "Assets and points of interest" },
];

export function ToolRail({
  tool,
  onTool,
  disabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDelete,
  canDelete,
}: Props) {
  return (
    <div className="pointer-events-auto flex flex-col gap-1 rounded-md border border-border bg-panel/95 p-1 shadow-lg backdrop-blur">
      {TOOLS.map(({ id, label, icon: Icon, hint }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <Button
              variant={tool === id ? "default" : "ghost"}
              size="icon"
              className={cn("size-9", tool === id && "shadow-inner")}
              disabled={disabled && id !== "pan"}
              onClick={() => onTool(id)}
              aria-label={label}
              aria-pressed={tool === id}
            >
              <Icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p className="font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </TooltipContent>
        </Tooltip>
      ))}

      <Separator className="my-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Undo"
          >
            <Undo2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Undo last edit</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="Redo"
          >
            <Redo2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Redo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-destructive hover:text-destructive"
            disabled={!canDelete}
            onClick={onDelete}
            aria-label="Delete selected feature"
          >
            <Trash2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Delete selected feature</TooltipContent>
      </Tooltip>
    </div>
  );
}
