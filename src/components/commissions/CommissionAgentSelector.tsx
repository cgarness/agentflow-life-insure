import { useEffect, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCommissionsAccess } from "@/hooks/useCommissionsCenter";
import { useCommissionAgentRoster } from "@/hooks/useCommissionAgentRoster";
import { isCommissionAuthorityError } from "@/hooks/commissionCenterQuery";
import { ME_SCOPE, commissionAgentScopeSchema, type CommissionAgentScope } from "@/lib/commission/centerScope";
import { useCommissionScope } from "./commissionScopeContext";

const selectedButtonClass = "bg-blue-600 text-white hover:bg-blue-700";

/** Checkbox/search edits are local drafts. Only Apply changes the URL and admitted financial selection. */
export function CommissionAgentSelector() {
  const context = useCommissionScope();
  const access = useCommissionsAccess();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CommissionAgentScope>(context.scope ?? ME_SCOPE);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const options = useCommissionAgentRoster(context.scope, { enabled: open, search, page, revision: context.revision });
  useEffect(() => {
    if (!open || !context.ready) return;
    if (options.error && isCommissionAuthorityError(options.error)) context.deny(options.error);
    if (options.data && options.data.scope_revision !== context.revision) {
      context.deny(new Error("Your agent access changed. Refresh the selection."));
    }
  }, [open, options.error, options.data, context]);
  if (!context.roster || !context.scope) return null;
  if (context.isMe && context.roster.available_count === 1 && context.canViewOwn) return null;
  const label = context.scope.mode === "me" ? "Me" : context.scope.mode === "all" ? "All agents" : context.scope.agentIds.length === 1
    ? context.roster.selected_agents.find((agent) => agent.agent_id === context.scope!.agentIds[0])?.display_name ?? "Selected agent"
    : `${context.scope.agentIds.length} agents`;
  const changeOpen = (next: boolean) => {
    if (next) { setDraft(context.scope!); setSearch(""); setPage(0); }
    setOpen(next);
  };
  const toggle = (id: string, checked: boolean) => {
    const ids = draft.mode === "selected" ? draft.agentIds : draft.mode === "me"
      ? access.userId ? [access.userId] : [] : [];
    setDraft({ mode: "selected", agentIds: checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id) });
  };
  const validDraft = commissionAgentScopeSchema.safeParse(draft).success;
  const agents = !options.error ? options.data?.agents ?? [] : [];
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Agents: ${label}`} className="max-w-full gap-2">
          <Users className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3" aria-label="Choose agents">
        <div role="group" aria-label="Agent selection" className="flex gap-2">
          {context.canViewOwn && <Button size="sm" variant={draft.mode === "me" ? "default" : "outline"}
            className={draft.mode === "me" ? selectedButtonClass : undefined} aria-pressed={draft.mode === "me"} onClick={() => setDraft(ME_SCOPE)}>Me</Button>}
          <Button size="sm" variant={draft.mode === "all" ? "default" : "outline"} className={draft.mode === "all" ? selectedButtonClass : undefined} aria-pressed={draft.mode === "all"}
            onClick={() => setDraft({ mode: "all", agentIds: [] })}>All agents</Button>
        </div>
        <Input aria-label="Search agents" placeholder="Search agents" maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value.slice(0, 200)); setPage(0); }} />
        <div className="max-h-64 space-y-1 overflow-y-auto" aria-busy={options.isFetching}>
          {options.isPending ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">Loading agents…</p>
            : options.isError ? <p role="alert" className="px-2 py-3 text-sm">Agents couldn't load.</p>
              : agents.length === 0 ? <p role="status" className="px-2 py-3 text-sm text-muted-foreground">No matching agents</p>
                : agents.map((agent) => <label key={agent.agent_id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent">
                  <Checkbox aria-label={`${agent.display_name}${agent.is_self ? " (Me)" : ""}, ${agent.agent_id}`}
                    checked={draft.mode === "me" ? agent.is_self : draft.mode === "selected" && draft.agentIds.includes(agent.agent_id)}
                    onCheckedChange={(checked) => toggle(agent.agent_id, checked === true)} />
                  <span className="min-w-0"><span className="block truncate">{agent.display_name}{agent.is_self ? " (Me)" : ""}</span>
                    <span className="block text-xs text-muted-foreground">{agent.agent_id.slice(0, 8)}{agent.status !== "Active" ? ` · ${agent.status || "Archived"}` : ""}</span>
                  </span>
                </label>)}
        </div>
        {(page > 0 || (options.data?.total_count ?? 0) > 50) && <div className="flex justify-between">
          <Button size="sm" variant="ghost" disabled={page === 0 || options.isFetching} onClick={() => setPage(page - 1)}>Previous agents</Button>
          <Button size="sm" variant="ghost" disabled={(page + 1) * 50 >= (options.data?.total_count ?? 0) || options.isFetching}
            onClick={() => setPage(page + 1)}>Next agents</Button>
        </div>}
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" className={selectedButtonClass} disabled={!validDraft || options.isError} onClick={() => { context.apply(draft); setOpen(false); }}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
