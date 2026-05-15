import React from "react";
import {
  TRIGGER_GROUPS, TRIGGER_LABELS, TRIGGER_COMING_SOON, type TriggerType,
} from "@/lib/workflow-types";

interface Props {
  value: TriggerType;
  onChange: (next: TriggerType) => void;
}

const TriggerTypeSelector: React.FC<Props> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(e) => {
      const next = e.target.value as TriggerType;
      if (TRIGGER_COMING_SOON[next]) return;
      onChange(next);
    }}
    className="h-9 w-full rounded-lg border-0 bg-accent px-3 text-sm text-foreground focus:ring-2 focus:ring-primary/50"
  >
    {TRIGGER_GROUPS.map((group) => (
      <optgroup key={group.label} label={group.label}>
        {group.triggers.map((t) => {
          const soon = !!TRIGGER_COMING_SOON[t];
          return (
            <option key={t} value={t} disabled={soon}>
              {TRIGGER_LABELS[t]}{soon ? " — Coming Soon" : ""}
            </option>
          );
        })}
      </optgroup>
    ))}
  </select>
);

export default TriggerTypeSelector;
