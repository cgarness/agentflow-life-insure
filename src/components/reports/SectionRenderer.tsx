import React, { useState } from "react";
import DraggableSection from "./DraggableSection";
import { SectionConfig } from "@/lib/report-layout-constants";

interface Props {
  sections: SectionConfig[];
  components: Record<string, React.ReactNode>;
  editMode: boolean;
  isAdmin: boolean;
  onSectionsChange: (sections: SectionConfig[]) => void;
}

const TEAM_SECTIONS = ["agent_performance_cards", "agent_efficiency", "goal_tracking"];

const SectionRenderer: React.FC<Props> = ({
  sections, components, editMode, isAdmin, onSectionsChange
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };

  const handleDragOver = (id: string) => {
    if (draggedId && draggedId !== id) {
      setDragOverId(id);
    }
  };

  const handleDrop = (id: string) => {
    if (!draggedId || draggedId === id) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const currentSections = [...sections];
    const draggedIndex = currentSections.findIndex(s => s.id === draggedId);
    const dropIndex = currentSections.findIndex(s => s.id === id);

    if (draggedIndex > -1 && dropIndex > -1) {
      const [draggedItem] = currentSections.splice(draggedIndex, 1);
      currentSections.splice(dropIndex, 0, draggedItem);
      onSectionsChange(currentSections);
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleToggleVisibility = (id: string) => {
    const newSections = sections.map(s => 
      s.id === id ? { ...s, visible: !s.visible } : s
    );
    onSectionsChange(newSections);
  };

  const renderSections = () => {
    const rendered: React.ReactNode[] = [];
    let currentStatGrid: React.ReactNode[] = [];
    let currentMainGrid: React.ReactNode[] = [];

    const flushStatGrid = () => {
      if (currentStatGrid.length > 0) {
        rendered.push(
          <div key={`stat-grid-${rendered.length}`} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {currentStatGrid}
          </div>
        );
        currentStatGrid = [];
      }
    };

    const flushMainGrid = () => {
      if (currentMainGrid.length > 0) {
        rendered.push(
          <div key={`main-grid-${rendered.length}`} className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {currentMainGrid}
          </div>
        );
        currentMainGrid = [];
      }
    };

    sections.forEach((section) => {
      // Role-based filtering: hide Team sections for agents completely
      if (!isAdmin && TEAM_SECTIONS.includes(section.id)) return;

      const content = components[section.id];
      if (!content && !section.id.startsWith("stat_")) return null;

      const element = (
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

      if (section.id.startsWith("stat_")) {
        // Flush any pending main grid items before rendering stat cards
        flushMainGrid();
        currentStatGrid.push(element);
      } else {
        // Flush any pending stat cards before rendering main sections
        flushStatGrid();
        currentMainGrid.push(element);
      }
    });

    flushStatGrid();
    flushMainGrid();
    
    return rendered;
  };

  return (
    <div className="space-y-4" onDragOver={(e) => e.preventDefault()}>
      {renderSections()}
    </div>
  );
};

export default SectionRenderer;
