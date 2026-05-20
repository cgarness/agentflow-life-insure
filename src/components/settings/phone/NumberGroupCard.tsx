import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Pencil, Trash2, Users, Plus } from "lucide-react";
import { formatPhoneNumber } from "@/utils/phoneUtils";
import type { NumberGroupRow, NumberGroupMemberRow } from "./usePhoneSettingsController";

type Props = {
  group: NumberGroupRow;
  members: NumberGroupMemberRow[];
  campaignCount: number;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddNumbers: () => void;
};

export const NumberGroupCard: React.FC<Props> = ({
  group,
  members,
  campaignCount,
  canManage,
  onEdit,
  onDelete,
  onAddNumbers,
}) => {
  const [expanded, setExpanded] = useState(false);

  const groupMembers = useMemo(
    () => members.filter((m) => m.number_group_id === group.id),
    [members, group.id],
  );

  return (
    <div className="rounded-lg border border-border/70 bg-card transition-colors hover:border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="truncate text-sm font-semibold text-foreground">{group.name}</h4>
              <Badge variant="secondary" className="text-[10px]">
                {groupMembers.length} {groupMembers.length === 1 ? "number" : "numbers"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {campaignCount} {campaignCount === 1 ? "campaign" : "campaigns"}
              </Badge>
            </div>
            {group.description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{group.description}</p>
            )}
          </div>
        </button>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit group">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete group"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border/60 px-4 py-3">
          {groupMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-4 text-center">
              <Users className="h-6 w-6 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">No numbers assigned to this group yet.</p>
              {canManage && (
                <Button size="sm" variant="outline" onClick={onAddNumbers}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add numbers
                </Button>
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-background">
                {groupMembers.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-foreground">
                        {m.phone_numbers ? formatPhoneNumber(m.phone_numbers.phone_number) : "—"}
                      </p>
                      {m.phone_numbers?.friendly_name && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {m.phone_numbers.friendly_name}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {canManage && (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="outline" onClick={onAddNumbers}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add / remove numbers
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
