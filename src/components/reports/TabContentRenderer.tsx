import React, { useState } from "react";
import DraggableSection from "./DraggableSection";
import { SectionConfig } from "@/lib/report-layout-constants";

interface Props {
  sections: SectionConfig[];
  components: Record<string, React.ReactNode>;
  editMode: boolean;
  onSectionsChange: (sections: SectionConfig[]) => void;
}

const TabContentRenderer: React.FC<Props> = ({
  sections, components, editMode, onSectionsChange
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

  return (
    <div className="space-y-4" onDragOver={(e) => e.preventDefault()}>
      {sections.map((section) => {
        const content = components[section.id];
        if (!content) return null; // Silently skip removed components

        return (
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
      })}
    </div>
  );
};

export default TabContentRenderer;
