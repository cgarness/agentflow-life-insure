import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StateSelector } from "@/components/shared/StateSelector";
import { TIMEZONE_GROUPS } from "@/utils/timezoneUtils";
import { CalendarIcon } from "lucide-react";
import { format as formatBtnDate } from "date-fns";
import { cn } from "@/lib/utils";

export type ContactsTab = "Leads" | "Clients" | "Recruits" | "Agents";

export interface DownlineAgent {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ContactsFilterValues {
  // Shared
  stateFilter: string;
  downlineAgentId: string;
  // Leads-specific
  statusFilter: string;
  sourceFilter: string;
  startDate: Date | undefined;
  endDate: Date | undefined;
  timezoneFilters: string[];
  callableNowFilter: boolean;
  attemptCountFilters: string[];
  lastDispositionFilter: string;
  // Clients-specific
  policyTypeFilter: string;
}

interface ContactsFilterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: ContactsTab;
  filters: ContactsFilterValues;
  onFiltersChange: (filters: ContactsFilterValues) => void;
  downlineAgents: DownlineAgent[];
  filterStatuses: string[];
}

const POLICY_TYPES = ["Term", "Whole Life", "IUL", "Final Expense"];

const ContactsFilterModal: React.FC<ContactsFilterModalProps> = ({
  open,
  onOpenChange,
  activeTab,
  filters,
  onFiltersChange,
  downlineAgents,
  filterStatuses,
}) => {
  // Local copy of filters for editing before applying
  const [local, setLocal] = useState<ContactsFilterValues>(filters);

  // Sync local state when modal opens or filters change externally
  useEffect(() => {
    if (open) setLocal(filters);
  }, [open, filters]);

  const update = (patch: Partial<ContactsFilterValues>) => {
    setLocal((prev) => ({ ...prev, ...patch }));
  };

  const handleApply = () => {
    onFiltersChange(local);
    onOpenChange(false);
  };

  const handleClearAll = () => {
    const cleared: ContactsFilterValues = {
      stateFilter: "",
      downlineAgentId: "",
      statusFilter: "",
      sourceFilter: "",
      startDate: undefined,
      endDate: undefined,
      timezoneFilters: [],
      callableNowFilter: false,
      attemptCountFilters: [],
      lastDispositionFilter: "",
      policyTypeFilter: "",
    };
    setLocal(cleared);
  };

  const showState = activeTab !== "Import History";
  const showDownline = activeTab === "Leads" || activeTab === "Clients" || activeTab === "Recruits";
  const showLeadFields = activeTab === "Leads";
  const showClientFields = activeTab === "Clients";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Filter {activeTab}</DialogTitle>
          <DialogDescription>
            Narrow down your {activeTab.toLowerCase()} using the filters below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ===== Status (Leads only) ===== */}
          {showLeadFields && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Status
              </label>
              <Select
                value={local.statusFilter || "_all"}
                onValueChange={(v) =>
                  update({ statusFilter: v === "_all" ? "" : v })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Statuses</SelectItem>
                  {filterStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ===== State (All tabs) ===== */}
          {showState && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                State
              </label>
              <StateSelector
                value={local.stateFilter}
                onChange={(v) => update({ stateFilter: v })}
                className="bg-muted border-border"
              />
            </div>
          )}

          {/* ===== Policy Type (Clients only) ===== */}
          {showClientFields && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Policy Type
              </label>
              <Select
                value={local.policyTypeFilter || "_all"}
                onValueChange={(v) =>
                  update({ policyTypeFilter: v === "_all" ? "" : v })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border">
                  <SelectValue placeholder="All Policy Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Policy Types</SelectItem>
                  {POLICY_TYPES.map((pt) => (
                    <SelectItem key={pt} value={pt}>
                      {pt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ===== Date Created (Leads only) ===== */}
          {showLeadFields && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Date Created
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-full justify-start bg-muted border-border font-normal text-sm",
                        !local.startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {local.startDate
                        ? formatBtnDate(local.startDate, "MM/dd/yy")
                        : "Start Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={local.startDate}
                      onSelect={(d) => update({ startDate: d ?? undefined })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-9 w-full justify-start bg-muted border-border font-normal text-sm",
                        !local.endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {local.endDate
                        ? formatBtnDate(local.endDate, "MM/dd/yy")
                        : "End Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={local.endDate}
                      onSelect={(d) => update({ endDate: d ?? undefined })}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* ===== Timezones (Leads only) ===== */}
          {showLeadFields && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Timezones
              </label>
              <div className="grid grid-cols-2 gap-y-1.5">
                {TIMEZONE_GROUPS.map((tz) => (
                  <div key={tz} className="flex items-center gap-2">
                    <Checkbox
                      id={`modal-tz-${tz}`}
                      checked={local.timezoneFilters.includes(tz)}
                      onCheckedChange={(checked) =>
                        update({
                          timezoneFilters: checked
                            ? [...local.timezoneFilters, tz]
                            : local.timezoneFilters.filter((t) => t !== tz),
                        })
                      }
                    />
                    <label
                      htmlFor={`modal-tz-${tz}`}
                      className="text-xs text-foreground cursor-pointer"
                    >
                      {tz}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== Callable Now (Leads only) ===== */}
          {showLeadFields && (
            <div className="flex items-center justify-between pt-1">
              <label className="text-xs font-medium text-muted-foreground">
                Callable Now (TCPA)
              </label>
              <Switch
                checked={local.callableNowFilter}
                onCheckedChange={(v) => update({ callableNowFilter: v })}
              />
            </div>
          )}

          {/* ===== Attempts (Leads only) ===== */}
          {showLeadFields && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Attempts
              </label>
              <div className="grid grid-cols-3 gap-2">
                {["0", "1-3", "5+"].map((range) => (
                  <div key={range} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`modal-att-${range}`}
                      checked={local.attemptCountFilters.includes(range)}
                      onCheckedChange={(checked) =>
                        update({
                          attemptCountFilters: checked
                            ? [...local.attemptCountFilters, range]
                            : local.attemptCountFilters.filter(
                                (r) => r !== range
                              ),
                        })
                      }
                    />
                    <label
                      htmlFor={`modal-att-${range}`}
                      className="text-xs text-foreground cursor-pointer"
                    >
                      {range}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== Last Disposition (Leads only) ===== */}
          {showLeadFields && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Last Disposition
              </label>
              <Select
                value={local.lastDispositionFilter || "_all"}
                onValueChange={(v) =>
                  update({ lastDispositionFilter: v === "_all" ? "" : v })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border">
                  <SelectValue placeholder="All Dispositions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">All Dispositions</SelectItem>
                  <SelectItem value="No Answer">No Answer</SelectItem>
                  <SelectItem value="Busy">Busy</SelectItem>
                  <SelectItem value="Voicemail">Voicemail</SelectItem>
                  <SelectItem value="Interested">Interested</SelectItem>
                  <SelectItem value="Not Interested">Not Interested</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ===== Downline Agent (Leads, Clients, Recruits) ===== */}
          {showDownline && downlineAgents.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Downline Agent
              </label>
              <Select
                value={local.downlineAgentId || "_all"}
                onValueChange={(v) =>
                  update({ downlineAgentId: v === "_all" ? "" : v })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border">
                  <SelectValue placeholder="All Agents (Mine + Downline)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">
                    All Agents (Mine + Downline)
                  </SelectItem>
                  {downlineAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.firstName} {agent.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row justify-between sm:justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            Clear All
          </Button>
          <Button onClick={handleApply}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ContactsFilterModal;
