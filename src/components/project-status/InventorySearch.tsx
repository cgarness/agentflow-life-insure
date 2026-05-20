import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface InventorySearchProps {
  value: string;
  onChange: (value: string) => void;
}

const InventorySearch: React.FC<InventorySearchProps> = ({ value, onChange }) => (
  <div className="relative max-w-md">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
    <Input
      className="pl-9"
      placeholder="Search modules, pages, debt, gaps…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default InventorySearch;

export function matchesQuery(text: string, query: string): boolean {
  if (!query.trim()) return true;
  return text.toLowerCase().includes(query.trim().toLowerCase());
}
