import React from "react";
import { Filter } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { StatusFilterValue } from "@/lib/project-status/treeUtils";

const OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "LIVE", label: "LIVE" },
  { value: "NEEDS_WORK", label: "NEEDS_WORK" },
  { value: "PLACEHOLDER", label: "PLACEHOLDER" },
  { value: "BROKEN", label: "BROKEN" },
  { value: "NOT_STARTED", label: "NOT_STARTED" },
  { value: "unset", label: "No status set" },
];

interface StatusFilterSelectProps {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
}

const StatusFilterSelect: React.FC<StatusFilterSelectProps> = ({ value, onChange }) => (
  <Select value={value} onValueChange={(v) => onChange(v as StatusFilterValue)}>
    <SelectTrigger className="w-full sm:w-[180px] h-9">
      <Filter className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
      <SelectValue placeholder="Filter by status" />
    </SelectTrigger>
    <SelectContent>
      {OPTIONS.map((o) => (
        <SelectItem key={o.value} value={o.value}>
          {o.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

export default StatusFilterSelect;
