import React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  search: string;
  setSearch: (v: string) => void;
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
}

/** Team Members search / role / status filters. They narrow the listed rows only — never the pickers. */
const TeamMembersFilters: React.FC<Props> = ({ search, setSearch, roleFilter, setRoleFilter, statusFilter, setStatusFilter }) => (
  <div className="flex flex-wrap gap-3 p-4 bg-accent/20 rounded-xl border border-border/50">
    <div className="relative flex-1 min-w-[240px]">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input
        placeholder="Search team by name, email, or role..."
        className="pl-9 bg-background/50 border-border/50 focus:border-primary/50 transition-all"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
    </div>
    <Select value={roleFilter} onValueChange={setRoleFilter}>
      <SelectTrigger aria-label="Filter by role" className="w-44 bg-background/50 border-border/50"><SelectValue placeholder="Filter by Role" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="All">All Roles</SelectItem>
        <SelectItem value="Admin">Admin</SelectItem>
        <SelectItem value="Team Leader">Team Leader</SelectItem>
        <SelectItem value="Agent">Agent</SelectItem>
      </SelectContent>
    </Select>
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger aria-label="Filter by status" className="w-44 bg-background/50 border-border/50"><SelectValue placeholder="Filter by Status" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="All">All Statuses</SelectItem>
        <SelectItem value="Active">Active</SelectItem>
        <SelectItem value="Inactive">Inactive</SelectItem>
        <SelectItem value="Pending">Pending</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

export default TeamMembersFilters;
