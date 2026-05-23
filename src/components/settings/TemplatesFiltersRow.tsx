import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TEMPLATE_CATEGORY_VALUES } from "@/components/settings/templateCategories";

interface TemplatesFiltersRowProps {
  search: string;
  onSearchChange: (v: string) => void;
  filterType: string;
  onFilterTypeChange: (v: string) => void;
  filterCategory: string;
  onFilterCategoryChange: (v: string) => void;
  filterScope: string;
  onFilterScopeChange: (v: string) => void;
}

export function TemplatesFiltersRow({
  search,
  onSearchChange,
  filterType,
  onFilterTypeChange,
  filterCategory,
  onFilterCategoryChange,
  filterScope,
  onFilterScopeChange,
}: TemplatesFiltersRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-64 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="bg-card pl-9"
        />
      </div>
      <Select value={filterScope} onValueChange={onFilterScopeChange}>
        <SelectTrigger className="w-40 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Visibility</SelectItem>
          <SelectItem value="agency">Agency</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filterType} onValueChange={onFilterTypeChange}>
        <SelectTrigger className="w-36 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="email">Email</SelectItem>
          <SelectItem value="sms">SMS</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filterCategory} onValueChange={onFilterCategoryChange}>
        <SelectTrigger className="w-44 bg-card">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {TEMPLATE_CATEGORY_VALUES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
