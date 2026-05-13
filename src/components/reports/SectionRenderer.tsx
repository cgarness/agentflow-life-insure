import React, { useState } from "react";
import DraggableSection from "./DraggableSection";
import { SectionConfig, MAX_VISIBLE_STATS } from "@/lib/report-layout-constants";
import { StatCategory, STAT_CATEGORIES, STAT_DEFINITION_MAP } from "@/lib/stat-computations";
import { EyeOff } from "lucide-react";
import { toast } from "sonner";

interface Props {
  sections: SectionConfig[];
  components: Record<string, React.ReactNode>;
  editMode: boolean;
  isAdmin: boolean;
  onSectionsChange: (sections: SectionConfig[]) => void;
}

const TEAM_SECTIONS = ["agent_performance_cards", "agent_efficiency", "goal_tracking"];
const CATEGORY_ORDER: StatCategory[] = ["activity", "results", "pipeline", "team"];

const SectionRenderer: React.FC<Props> = ({
  sections, components, editMode, isAdmin, onSectionsChange,
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (id: string) => setDraggedId(id);
  const handleDragOver = (id: string) => {
    if (draggedId && draggedId !== id) setDragOverId(id);
  };

  const handleDrop = (id: string) => {
    if (!draggedId || draggedId === id) { setDraggedId(null); setDragOverId(null); return; }
    const current = [...sections];
    const from = current.findIndex(s => s.id === draggedId);
    const to = current.findIndex(s => s.id === id);
    if (from > -1 && to > -1) {
      const [item] = current.splice(from, 1);
      current.splice(to, 0, item);
      onSectionsChange(current);
    }
    setDraggedId(null); setDragOverId(null);
  };

  const handleToggleVisibility = (id: string) => {
    const section = sections.find(s => s.id === id);
    if (!section) return;

    if (!section.visible && id.startsWith("stat_")) {
      const visibleCount = sections.filter(s => s.id.startsWith("stat_") && s.visible).length;
      if (visibleCount >= MAX_VISIBLE_STATS) {
        toast.error(`Maximum ${MAX_VISIBLE_STATS} stats — hide one to add another.`);
        return;
      }
    }

    onSectionsChange(sections.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  const visibleStatSections: SectionConfig[] = [];
  const hiddenStatSections: SectionConfig[] = [];
  const otherSections: SectionConfig[] = [];

  for (const s of sections) {
    if (!isAdmin && TEAM_SECTIONS.includes(s.id)) continue;
    if (s.id.startsWith("stat_")) {
      if (s.visible) visibleStatSections.push(s);
      else hiddenStatSections.push(s);
    } else {
      otherSections.push(s);
    }
  }

  // Group visible stats by category, preserving user order within each category
  const byCat = new Map<string, SectionConfig[]>(CATEGORY_ORDER.map(c => [c, []]));
  for (const s of visibleStatSections) {
    const cat = STAT_DEFINITION_MAP[s.id]?.category;
    if (cat) byCat.get(cat)?.push(s);
  }

  // Group hidden stats by category for the edit-mode picker
  const hiddenByCategory = new Map<string, SectionConfig[]>();
  for (const s of hiddenStatSections) {
    const def = STAT_DEFINITION_MAP[s.id];
    if (!def) continue;
    const arr = hiddenByCategory.get(def.category) ?? [];
    arr.push(s);
    hiddenByCategory.set(def.category, arr);
  }

  const dragProps = (s: SectionConfig) => ({
    id: s.id, visible: s.visible, editMode,
    isDragging: draggedId === s.id, dragOverId,
    onDragStart: handleDragStart, onDragOver: handleDragOver,
    onDrop: handleDrop, onToggleVisibility: handleToggleVisibility,
  });

  const renderOtherSections = (): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let batch: React.ReactNode[] = [];
    const flush = () => {
      if (!batch.length) return;
      out.push(
        <div key={`grid-${out.length}`} className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {batch}
        </div>
      );
      batch = [];
    };
    otherSections.forEach((section) => {
      const content = components[section.id];
      if (!content) return;
      batch.push(
        <DraggableSection key={section.id} {...dragProps(section)}>
          {content}
        </DraggableSection>
      );
    });
    flush();
    return out;
  };

  return (
    <div className="space-y-0" onDragOver={(e) => e.preventDefault()}>
      {/* Category-grouped stat cards */}
      <div className="mb-4">
        {CATEGORY_ORDER.map((cat) => {
          const items = byCat.get(cat) ?? [];
          if (!items.length) return null;
          const meta = STAT_CATEGORIES[cat];
          return (
            <div key={cat} className="mb-4">
              <p className="text-[11px] uppercase tracking-[0.5px] text-muted-foreground font-semibold mb-2">
                {meta.label}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                {items.map((s) => (
                  <DraggableSection key={s.id} {...dragProps(s)}>
                    {components[s.id]}
                  </DraggableSection>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit-mode picker: hidden stats grouped by category */}
      {editMode && hiddenStatSections.length > 0 && (
        <div className="mb-6 mt-2 border-t border-border/50 pt-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Available stats — toggle to add
          </p>
          <div className="space-y-4">
            {Array.from(hiddenByCategory.entries()).map(([cat, items]) => {
              const meta = STAT_CATEGORIES[cat as keyof typeof STAT_CATEGORIES];
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: meta?.color }} />
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                      {meta?.label ?? cat}
                    </span>
                  </div>
                  <div className="grid gap-[8px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                    {items.map((s) => {
                      const def = STAT_DEFINITION_MAP[s.id];
                      return (
                        <button
                          key={s.id}
                          onClick={() => handleToggleVisibility(s.id)}
                          className="flex items-center justify-between gap-2 px-2.5 py-2 bg-card border border-border/50 hover:border-primary/50 transition-colors text-left"
                          style={{ borderLeft: `3px solid ${meta?.color}` }}
                          title={`Show ${def?.label}`}
                        >
                          <span className="text-xs font-medium truncate">{def?.label ?? s.id}</span>
                          <EyeOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {renderOtherSections()}
    </div>
  );
};

export default SectionRenderer;
