import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBranding } from "@/contexts/BrandingContext";
import { useContactFollowUps } from "@/hooks/useContactFollowUps";
import type { ContactType } from "@/lib/dashboard-contact-identity";
import type { ContactFollowUp } from "@/lib/contactFollowUps";
import { AddTaskModal } from "@/components/contacts/AddTaskModal";
import { ContactFollowUpsDialog } from "./ContactFollowUpsDialog";
import { FollowUpKindIcon, FollowUpStatusChip } from "./FollowUpRow";
import { FOLLOW_UP_KIND_LABEL, formatFollowUpAssignee, formatFollowUpDue } from "./followUpFormat";

export interface ContactFollowUpsCardProps {
  contactId: string;
  contactType: ContactType;
  organizationId: string | null | undefined;
  agents: { id: string; firstName: string; lastName: string }[];
  resolveAgentName: (id: string) => string;
  /** Bumped by the page after its own writes (Schedule) to refetch. */
  refreshKey: number;
  onAddAppointment: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Compact, read-only Follow-ups card for the existing contact page: the next follow-up, a count of
 * the rest, and View all. Every state renders at the same fixed body height so the panel below never
 * jumps. Visibility is whatever RLS lets this viewer read — hence the header tooltip.
 */
export function ContactFollowUpsCard({
  contactId,
  contactType,
  organizationId,
  agents,
  resolveAgentName,
  refreshKey,
  onAddAppointment,
}: ContactFollowUpsCardProps) {
  const { formatDate, formatDateTime } = useBranding();
  const { state, items, summary, refreshFailed, refetch } = useContactFollowUps({
    contactId,
    contactType,
    organizationId,
    refreshKey,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const dueText = (item: ContactFollowUp) => formatFollowUpDue(item, { formatDate, formatDateTime });
  const assigneeText = (item: ContactFollowUp) => formatFollowUpAssignee(item, resolveAgentName);
  const primary = summary.primary;
  const atLeast = summary.truncated ? "at least " : "";

  const footerParts: string[] = [];
  if (summary.others > 0) footerParts.push(`${atLeast}${plural(summary.others, "other follow-up")}`);
  if (summary.overdue > 0) footerParts.push(`${summary.overdue} overdue`);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm shrink-0 overflow-hidden" data-testid="contact-follow-ups-card">
      <div className="px-4 h-8 flex items-center justify-between border-b border-border bg-muted/10">
        <p
          className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest"
          title="Shows follow-ups you have access to"
        >
          Follow-ups
        </p>
        {state === "ready" && items.length > 0 && (
          <button type="button" onClick={() => setDialogOpen(true)} className="text-[10px] font-bold text-primary hover:underline">
            View all
          </button>
        )}
      </div>

      <div className="px-4 py-2 h-[72px] flex flex-col justify-center gap-1 min-w-0">
        {state === "loading" && (
          <>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </>
        )}

        {state === "error" && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Couldn't load follow-ups</p>
            <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold uppercase" onClick={refetch}>
              Retry
            </Button>
          </div>
        )}

        {state === "ready" && !primary && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">No follow-ups scheduled</p>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold uppercase tracking-wider gap-1.5">
                  <Plus className="w-3 h-3" /> Add follow-up
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onAddAppointment}>Appointment</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTaskOpen(true)}>Task</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {state === "ready" && primary && (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <FollowUpKindIcon kind={primary.kind} />
              <p className="text-xs text-foreground truncate">
                <span className="font-semibold">{FOLLOW_UP_KIND_LABEL[primary.kind]}</span> · {dueText(primary)}
              </p>
              <FollowUpStatusChip item={primary} />
            </div>
            <p className="text-xs text-foreground truncate">
              {primary.title} · <span className="text-muted-foreground">{assigneeText(primary)}</span>
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {footerParts.join(" · ")}
              {refreshFailed && (
                <>
                  {footerParts.length > 0 ? " · " : ""}Couldn't refresh ·{" "}
                  <button type="button" onClick={refetch} className="text-primary hover:underline">
                    Retry
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>

      <ContactFollowUpsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        items={items}
        truncated={summary.truncated}
        dueText={dueText}
        assigneeText={assigneeText}
      />
      {taskOpen && (
        <AddTaskModal open onOpenChange={setTaskOpen} contactId={contactId} contactType={contactType} agents={agents} />
      )}
    </div>
  );
}
