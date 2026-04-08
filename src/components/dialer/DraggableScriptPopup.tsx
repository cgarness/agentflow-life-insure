import React from "react";
import { motion } from "framer-motion";
import { X, GripVertical, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DraggableScriptPopupProps {
  name: string;
  content: string;
  onClose: () => void;
  initialX?: number;
  initialY?: number;
}

const DraggableScriptPopup: React.FC<DraggableScriptPopupProps> = ({
  name,
  content,
  onClose,
  initialX = 400,
  initialY = 100,
}) => {
  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={{ x: initialX, y: initialY, opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{ zIndex: 100, position: "fixed", top: 0, left: 0 }}
      className="w-[450px] bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Header / Drag Handle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40 cursor-grab active:cursor-grabbing group">
        <div className="flex items-center gap-2 overflow-hidden">
          <GripVertical className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
          <div className="flex items-center gap-1.5 overflow-hidden">
            <FileText className="w-4 h-4 text-primary shrink-0" />
            <h3 className="text-sm font-semibold truncate text-foreground">{name}</h3>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-5 overflow-y-auto max-h-[500px] custom-scrollbar">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {content || "No content available for this script."}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border bg-muted/20 flex justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close Script
        </Button>
      </div>
    </motion.div>
  );
};

export default DraggableScriptPopup;
