import React from "react";
import { Sparkles } from "lucide-react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onLoadDefault: () => void;
}

export const AITestingPromptEditor: React.FC<Props> = ({ value, onChange, onLoadDefault }) => (
  <section className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm font-medium text-foreground">Agent instructions</label>
      <button
        type="button"
        onClick={onLoadDefault}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
      >
        <Sparkles className="w-3.5 h-3.5" />
        Load appointment-setting prompt
      </button>
    </div>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={14}
      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono text-[13px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  </section>
);
