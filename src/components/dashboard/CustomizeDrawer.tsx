import React from "react";
import { X, GripVertical, RotateCcw, Zap, BarChart3, Minimize2, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface WidgetConfig {
  id: string;
  label: string;
  visible: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  widgets: WidgetConfig[];
  onWidgetsChange: (widgets: WidgetConfig[]) => void;
  onReset: () => void;
}

const SortableItem: React.FC<{
  widget: WidgetConfig;
  onToggle: (id: string) => void;
}> = ({ widget, onToggle }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-muted/50 border border-border rounded-lg px-3 py-3 mb-2"
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm font-medium text-foreground">{widget.label}</span>
      <Switch
        checked={widget.visible}
        onCheckedChange={() => onToggle(widget.id)}
      />
    </div>
  );
};

interface Preset {
  id: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  description: string;
  config: Record<string, boolean>;
  order: string[];
}

const PRESETS: Preset[] = [
  {
    id: "sales-focus",
    label: "Sales Focus",
    icon: Zap,
    description: "Calls, follow-ups & wins",
    config: {
      "stat-cards": true,
      "daily-briefing": true,
      "activity-chart": true,
      "recent-activity": false,
      "quick-actions": true,
      "leaderboard": false,
    },
    order: ["stat-cards", "daily-briefing", "quick-actions", "activity-chart", "recent-activity", "leaderboard"],
  },
  {
    id: "manager-view",
    label: "Manager View",
    icon: BarChart3,
    description: "Leaderboard & activity",
    config: {
      "stat-cards": true,
      "daily-briefing": false,
      "activity-chart": true,
      "recent-activity": true,
      "quick-actions": false,
      "leaderboard": true,
    },
    order: ["stat-cards", "leaderboard", "activity-chart", "recent-activity", "daily-briefing", "quick-actions"],
  },
  {
    id: "minimal",
    label: "Minimal",
    icon: Minimize2,
    description: "Just the essentials",
    config: {
      "stat-cards": true,
      "daily-briefing": true,
      "activity-chart": false,
      "recent-activity": false,
      "quick-actions": false,
      "leaderboard": false,
    },
    order: ["stat-cards", "daily-briefing", "activity-chart", "recent-activity", "quick-actions", "leaderboard"],
  },
];

function applyPreset(preset: Preset, current: WidgetConfig[]): WidgetConfig[] {
  const labelMap = Object.fromEntries(current.map((w) => [w.id, w.label]));
  return preset.order.map((id) => ({
    id,
    label: labelMap[id] || id,
    visible: preset.config[id] ?? true,
  }));
}

function checkPresetActive(preset: Preset, current: WidgetConfig[]): boolean {
  return current.every((w) => preset.config[w.id] === w.visible) &&
    current.map((w) => w.id).join(",") === preset.order.join(",");
}

const CustomizeDrawer: React.FC<Props> = ({ open, onClose, widgets, onWidgetsChange, onReset }) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = widgets.findIndex((w) => w.id === active.id);
      const newIndex = widgets.findIndex((w) => w.id === over.id);
      onWidgetsChange(arrayMove(widgets, oldIndex, newIndex));
    }
  };

  const handleToggle = (id: string) => {
    onWidgetsChange(
      widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w))
    );
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 transition-opacity"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-[360px] max-w-full bg-card border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Customize Dashboard</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Widget list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground mb-3">
            Drag to reorder. Toggle to show or hide widgets.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={widgets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              {widgets.map((w) => (
                <SortableItem key={w.id} widget={w} onToggle={handleToggle} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border">
          <button
            onClick={onReset}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to Default
          </button>
        </div>
      </div>
    </>
  );
};

export default CustomizeDrawer;
