import React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EditorSaveBarProps {
  dirty: boolean;
  busy: boolean;
  /** Grid-wide and rate validation messages (field messages are shown beside their fields). */
  summary: string[];
  canSave: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

/** Sticky save bar of the grid editor. Bleeds to the Settings card's edges (its padding is p-6). */
const EditorSaveBar: React.FC<EditorSaveBarProps> = ({ dirty, busy, summary, canSave, onDiscard, onSave }) => (
  <div className="sticky bottom-0 z-30 -mx-6 border-t border-border/60 bg-card/95 px-6 py-3 shadow-[0_-8px_16px_-12px_hsl(var(--foreground)/0.25)] backdrop-blur-sm supports-[backdrop-filter]:bg-card/85">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1 text-xs">
        <p className={cn("flex items-center gap-2", dirty ? "font-medium text-foreground" : "text-muted-foreground")}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", dirty ? "bg-warning" : "bg-success")} aria-hidden />
          {dirty ? "Unsaved changes" : "All changes saved"}
        </p>
        {summary.map((message) => (
          <p key={message} className="flex items-start gap-1.5 text-destructive">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            {message}
          </p>
        ))}
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Button variant="outline" className="flex-1 sm:flex-none" disabled={!dirty || busy} onClick={onDiscard}>Discard</Button>
        <Button className="flex-1 sm:flex-none" disabled={!canSave} onClick={onSave}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />} Save changes
        </Button>
      </div>
    </div>
  </div>
);

export default EditorSaveBar;
