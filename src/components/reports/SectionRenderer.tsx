import React, { useState } from "react";
import DraggableSection from "./DraggableSection";
import { SectionConfig } from "@/lib/report-layout-constants";
import { STAT_CATEGORIES, STAT_DEFINITION_MAP } from "@/lib/stat-computations";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  sections: SectionConfig[];
  components: Record<string, React.ReactNode>;
  editMode: boolean;
  isAdmin: boolean;
  onSectionsChange: (sections: SectionConfig[]) => void;
}

const TEAM_SECTIONS = ["agent_performance_cards", "agent_efficiency", "goal_tracking"];

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
    if (!draggedId || draggedId === id) {
      setDraggedId(null); setDragOverId(null); return;
    }
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
    onSectionsChange(sections.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  // Partition: visible stats (in order), hidden stats (by category), other sections
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

  // Group hidden stats by category for edit mode picker
  const hiddenByCategory = new Map<string, SectionConfig[]>();
  for (const s of hiddenStatSections) {
    const def = STAT_DEFINITION_MAP[s.id];
    if (!def) continue;
    const arr = hiddenByCategory.get(def.category) ?? [];
    arr.push(s);
    hiddenByCategory.set(def.category, arr);
  }

  // Render main sections (charts) grouping consecutive ones into a 2-col grid
  const renderOtherSections = (): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let batch: React.ReactNode[] = [];
    const flush = () => {
      if (batch.length === 0) return;
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
        <DraggableSection
          key={section.id}
          id={section.id}
          visible={section.visible}
          editMode={editMode}
          isDragging={draggedId === section.id}
          dragOverId={dragOverId}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onToggleVisibility={handleToggleVisibility}
        >
          {content}
        </DraggableSection>
      );
    });
    flush();
    return out;
  };

  const visibleStatGrid = (
    <div
      className="grid gap-[10px] mb-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
    >
      {visibleStatSections.map((section) => (
        <DraggableSection
          key={section.id}
          id={section.id}
          visible={section.visible}
          editMode={editMode}
          isDragging={draggedId === section.id}
          dragOverId={dragOverId}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onToggleVisibility={handleToggleVisibility}
        >
          {components[section.id]}
        </DraggableSection>
      ))}
    </div>
  );

  const hiddenStatsPicker = editMode && hiddenStatSections.length > 0 && (
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
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: meta?.color }}
                />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {meta?.label ?? cat}
                </span>
              </div>
              <div
                className="grid gap-[8px]"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
              >
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
  );

  // Optional: a small "show all hidden charts" hint not needed for stats picker
  void Eye; // silence unused import in some builds

  return (
    <div className="space-y-4" onDragOver={(e) => e.preventDefault()}>
      {visibleStatGrid}
      {hiddenStatsPicker}
      {renderOtherSections()}
    </div>
  );
};

export default SectionRenderer;
