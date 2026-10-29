import React from "react";
import { ChevronRight, EyeOff, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardWidgetKey } from "@/lib/dashboard-widget-prefs";
import { DASHBOARD_TONES } from "@/components/dashboard/ui/dashboardTones";
import { DASHBOARD_WIDGET_META } from "@/components/dashboard/ui/dashboardWidgetMeta";

interface DashboardWidgetFrameProps {
  widgetKey: DashboardWidgetKey;
  editMode: boolean;
  /** Opens the widget's detail view; omitted for widgets without one. */
  onOpenDetails?: () => void;
  onHide?: (key: DashboardWidgetKey) => void;
  /** dnd-kit handle props (attributes + listeners) in edit mode. */
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  children: React.ReactNode;
}

/**
 * The card around every Dashboard widget, in both the static grid and edit mode.
 * Opening details is a real button (keyboard and screen reader reachable); the
 * header band stays clickable for the mouse, as before. Only the header opens the
 * modal, never the widget body.
 */
export const DashboardWidgetFrame: React.FC<DashboardWidgetFrameProps> = ({
  widgetKey,
  editMode,
  onOpenDetails,
  onHide,
  dragHandleProps,
  children,
}) => {
  const meta = DASHBOARD_WIDGET_META[widgetKey];
  const tone = DASHBOARD_TONES[meta.tone];
  const Icon = meta.icon;
  const opensDetails = !editMode && !!onOpenDetails;

  return (
    <section
      aria-label={meta.label}
      className={cn(
        "glass-card flex h-full flex-col rounded-2xl border transition-shadow duration-200 hover:shadow-xl motion-reduce:transition-none",
        tone.border,
      )}
    >
      <div
        className={cn("flex items-center gap-3 rounded-t-2xl border-b px-5 py-3.5", tone.border, tone.band, opensDetails && "cursor-pointer")}
        onClick={opensDetails ? onOpenDetails : undefined}
      >
        {editMode && dragHandleProps && (
          <button
            type="button"
            aria-label={`Reorder ${meta.label}`}
            className="cursor-grab rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing motion-reduce:transition-none"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm", tone.chip)}>
          <Icon className="h-4 w-4 text-white" aria-hidden="true" />
        </span>
        <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">{meta.label}</h3>
        <div className="ml-auto flex items-center gap-1">
          {opensDetails && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Open ${meta.label} details`}
              className={cn("h-8 gap-0.5 rounded-lg px-2 text-xs font-semibold transition-colors motion-reduce:transition-none hover:bg-background/70", tone.text, tone.ring)}
              onClick={(event) => {
                event.stopPropagation();
                onOpenDetails?.();
              }}
            >
              <span className="hidden sm:inline">Details</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
          {editMode && onHide && (
            <button
              type="button"
              aria-label={`Hide ${meta.label} widget`}
              onClick={() => onHide(widgetKey)}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
};

/**
 * Edit-mode wrapper (moved from `pages/Dashboard.tsx`). dnd-kit positions the dragged
 * card through its own transform style; that is the library's contract, not styling.
 */
export const SortableWidgetFrame: React.FC<{
  id: DashboardWidgetKey;
  onHide: (id: DashboardWidgetKey) => void;
  children: React.ReactNode;
}> = ({ id, onHide, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}>
      <DashboardWidgetFrame widgetKey={id} editMode onHide={onHide} dragHandleProps={{ ...attributes, ...listeners }}>
        {children}
      </DashboardWidgetFrame>
    </div>
  );
};
