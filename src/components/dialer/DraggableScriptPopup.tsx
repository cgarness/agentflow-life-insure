import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, GripHorizontal, Maximize2, Minimize2 } from "lucide-react";

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
  initialY = 150,
}) => {
  const [isMinimized, setIsMinimized] = useState(false);

  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={{ x: initialX, y: initialY, opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-50 bg-card border shadow-2xl rounded-xl overflow-hidden min-w-[320px] max-w-[450px]"
      style={{ touchAction: "none" }}
    >
      {/* Header / Drag Handle */}
      <div className="flex items-center justify-between px-4 py-2 bg-accent border-b cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 overflow-hidden">
          <GripHorizontal className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold truncate text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 hover:bg-background/50 rounded transition-colors text-muted-foreground hover:text-foreground"
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <AnimatePresence>
        {!isMinimized && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="p-4 overflow-y-auto max-h-[400px]"
          >
            <div className="prose prose-sm dark:prose-invert text-foreground whitespace-pre-wrap leading-relaxed">
              {content}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default DraggableScriptPopup;
