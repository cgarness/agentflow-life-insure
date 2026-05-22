import React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { OnboardingItem } from "@/lib/types";

interface Props {
  items: OnboardingItem[];
  onToggle: (key: string, checked: boolean) => void;
  onReset: () => void;
}

const UserOnboardingTab: React.FC<Props> = ({ items, onToggle, onReset }) => {
  const pct = items.length ? Math.round(items.filter(i => i.completed).length / items.length * 100) : 0;

  return (
    <div className="space-y-4 mt-0">
      <div className="flex items-center justify-between p-1">
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground mb-1.5">Completion: {pct}%</p>
          <Progress value={pct} className="h-2" />
        </div>
        <Button variant="outline" size="sm" className="ml-6" onClick={onReset}>Reset Checklist</Button>
      </div>
      <div className="grid grid-cols-1 gap-2 mt-2">
        {items.map(item => (
          <label key={item.key} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 cursor-pointer transition-colors">
            <Checkbox checked={item.completed} onCheckedChange={(c) => onToggle(item.key, !!c)} />
            <span className={`flex-1 text-sm ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>{item.label}</span>
            {item.completedAt && <span className="text-xs text-muted-foreground">{new Date(item.completedAt).toLocaleDateString()}</span>}
          </label>
        ))}
      </div>
    </div>
  );
};

export default UserOnboardingTab;
