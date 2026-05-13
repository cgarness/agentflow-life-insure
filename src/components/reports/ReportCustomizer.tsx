import React from "react";
import { Check, Settings2, RotateCcw, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  editMode: boolean;
  isAdmin: boolean;
  onSave: () => void;
  onReset: () => void;
  onSaveAsDefault: () => void;
}

const ReportCustomizer: React.FC<Props> = ({
  editMode, isAdmin, onSave, onReset, onSaveAsDefault
}) => {
  if (!editMode) return null;

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-3 text-primary">
        <Settings2 className="w-5 h-5" />
        <p className="font-medium text-sm">
          Customizing layout — drag sections to reorder, toggle visibility.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button 
          onClick={onReset}
          className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset to default
        </button>
        
        {isAdmin && (
          <button 
            onClick={onSaveAsDefault}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors pl-2 border-l border-border"
          >
            <Building2 className="w-3.5 h-3.5" />
            Set as org default
          </button>
        )}
        
        <Button onClick={onSave} size="sm" className="ml-2 gap-1.5 h-8">
          <Check className="w-4 h-4" />
          Done
        </Button>
      </div>
    </div>
  );
};

export default ReportCustomizer;
