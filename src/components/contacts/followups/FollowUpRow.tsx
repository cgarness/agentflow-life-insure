import React from "react";
import { Calendar, CheckCircle2, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactFollowUp, FollowUpKind } from "@/lib/contactFollowUps";
import { FOLLOW_UP_KIND_LABEL } from "./followUpFormat";

const KIND_ICON: Record<FollowUpKind, React.ComponentType<{ className?: string }>> = {
  appointment: Calendar,
  callback: PhoneCall,
  task: CheckCircle2,
};

export function FollowUpKindIcon({ kind, className }: { kind: FollowUpKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon className={cn("w-3.5 h-3.5 shrink-0 text-muted-foreground", className)} />;
}

export function FollowUpStatusChip({ item }: { item: ContactFollowUp }) {
  if (item.isOverdue) {
    return (
      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-600">
        Overdue
      </span>
    );
  }
  if (item.inProgress) {
    return (
      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-primary/10 text-primary">
        In progress
      </span>
    );
  }
  return null;
}

interface FollowUpRowProps {
  item: ContactFollowUp;
  dueText: string;
  assigneeText: string;
}

/** One follow-up in the View-all dialog. */
export function FollowUpRow({ item, dueText, assigneeText }: FollowUpRowProps) {
  return (
    <div
      className={cn(
        "border-l-2 pl-3 py-1.5 rounded-r-md",
        item.isOverdue ? "border-amber-500" : "border-primary/30",
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <FollowUpKindIcon kind={item.kind} />
        <p className="text-xs text-foreground truncate">
          <span className="font-semibold">{FOLLOW_UP_KIND_LABEL[item.kind]}</span> · {dueText}
        </p>
        <FollowUpStatusChip item={item} />
      </div>
      <p className="text-xs text-foreground leading-snug truncate mt-0.5">{item.title}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
        {assigneeText} · {item.statusLabel}
      </p>
      {item.note && <p className="text-[10px] text-muted-foreground italic mt-0.5 line-clamp-2">{item.note}</p>}
    </div>
  );
}
