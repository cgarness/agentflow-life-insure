import React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { groupFollowUps, type ContactFollowUp } from "@/lib/contactFollowUps";
import { FollowUpRow } from "./FollowUpRow";

interface ContactFollowUpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ContactFollowUp[];
  truncated: boolean;
  dueText: (item: ContactFollowUp) => string;
  assigneeText: (item: ContactFollowUp) => string;
}

function Section({
  title,
  items,
  dueText,
  assigneeText,
}: {
  title: string;
  items: ContactFollowUp[];
  dueText: (item: ContactFollowUp) => string;
  assigneeText: (item: ContactFollowUp) => string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title} ({items.length})
      </h4>
      <div className="space-y-2">
        {items.map((item) => (
          <FollowUpRow key={item.key} item={item} dueText={dueText(item)} assigneeText={assigneeText(item)} />
        ))}
      </div>
    </section>
  );
}

/** Read-only list of every open follow-up on the contact, overdue first. */
export function ContactFollowUpsDialog({
  open,
  onOpenChange,
  items,
  truncated,
  dueText,
  assigneeText,
}: ContactFollowUpsDialogProps) {
  const { overdue, upcoming } = groupFollowUps(items);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Follow-ups</DialogTitle>
          <DialogDescription>
            Open appointments, callbacks and tasks on this contact that you have access to.
            {truncated ? " Showing the first results only." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Section title="Overdue" items={overdue} dueText={dueText} assigneeText={assigneeText} />
          <Section title="Upcoming" items={upcoming} dueText={dueText} assigneeText={assigneeText} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
