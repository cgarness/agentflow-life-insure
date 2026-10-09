import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COLUMN_DEFS, type ColumnId, type ColumnLayout } from "@/lib/campaigns-table/columns";

export interface ColumnsMenuPrefs {
  layout: ColumnLayout;
  draft: ColumnLayout | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  busy: boolean;
  canEdit: boolean;
  beginEdit: () => void;
  cancel: () => void;
  setDraft: (layout: ColumnLayout) => void;
  save: () => Promise<boolean>;
  reset: () => Promise<boolean>;
  reload: () => void;
}

function Locked({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
      <Lock className="h-3.5 w-3.5" aria-hidden="true" /><span className="flex-1">{label}</span>
      <span className="sr-only">(always shown)</span>
    </li>
  );
}

/** Show/hide and reorder the middle columns. Writes only on Save/Reset; previews live. */
export default function CampaignColumnsMenu({ prefs }: { prefs: ColumnsMenuPrefs }) {
  const [open, setOpen] = useState(false);
  const retryPending = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const draft = prefs.draft;
  // Keep keyboard focus on the moved column; at an edge the pressed arrow disables, so use the other one.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${pendingFocus.current}"]`);
    pendingFocus.current = null;
    target?.focus();
  }, [draft]);
  // After a Retry from the error view, start editing as soon as the reload succeeds.
  const { canEdit, beginEdit } = prefs;
  useEffect(() => {
    if (open && retryPending.current && canEdit && !draft) {
      retryPending.current = false;
      beginEdit();
    }
  }, [open, canEdit, draft, beginEdit]);
  const hidden = new Set(draft?.hidden ?? []);

  const onOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      if (prefs.canEdit) prefs.beginEdit();
      return;
    }
    if (prefs.busy) return;
    retryPending.current = false;
    prefs.cancel();
    setOpen(false);
  };
  const toggle = (id: ColumnId) => {
    if (!draft) return;
    const nextHidden = hidden.has(id) ? draft.hidden.filter((h) => h !== id) : [...draft.hidden, id];
    prefs.setDraft({ order: draft.order, hidden: nextHidden });
  };
  const move = (index: number, delta: -1 | 1) => {
    if (!draft) return;
    const to = index + delta;
    if (to < 0 || to >= draft.order.length) return;
    const atEdge = to === 0 || to === draft.order.length - 1;
    const forward = delta < 0 ? "up" : "down";
    pendingFocus.current = `${draft.order[index]}:${atEdge ? (delta < 0 ? "down" : "up") : forward}`;
    const order = [...draft.order];
    [order[index], order[to]] = [order[to], order[index]];
    prefs.setDraft({ order, hidden: draft.hidden });
  };
  const finish = async (action: () => Promise<boolean>, button: HTMLButtonElement | null) => {
    if (await action()) setOpen(false);
    else setTimeout(() => button?.focus(), 0); // the busy fieldset disabled it; restore focus for a retry
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={prefs.status === "loading" || prefs.status === "idle"}
          className="h-9 gap-2 rounded-lg border-border/70 bg-card">
          <Columns3 className="h-4 w-4" aria-hidden="true" />Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" aria-label="Customize columns"
        onEscapeKeyDown={(e) => { if (prefs.busy) e.preventDefault(); }}
        onInteractOutside={(e) => { if (prefs.busy) e.preventDefault(); }}>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Columns</p>
        </div>
        {prefs.status === "error" && !draft ? (
          <div className="space-y-3 px-4 py-4">
            <p role="alert" className="text-sm text-muted-foreground">{prefs.error ?? "Couldn't load saved columns."}</p>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-2" onClick={() => { retryPending.current = true; prefs.reload(); }}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Retry
            </Button>
          </div>
        ) : draft ? (
          <fieldset disabled={prefs.busy} aria-busy={prefs.busy} className="min-w-0">
            <legend className="sr-only">Visible columns and order</legend>
            <ul ref={listRef} className="max-h-[26rem] overflow-y-auto px-2 py-2">
              <Locked label="Campaign" />
              {draft.order.map((id, index) => {
                const label = COLUMN_DEFS[id].label;
                const inputId = `campaign-column-${id}`;
                return (
                  <li key={id} data-column-option={id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50">
                    <Checkbox id={inputId} checked={!hidden.has(id)} onCheckedChange={() => toggle(id)} aria-label={`Show ${label}`} />
                    <label htmlFor={inputId} className="flex-1 cursor-pointer text-sm text-foreground">{label}</label>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${label} up`} data-move={`${id}:up`}
                      disabled={index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${label} down`} data-move={`${id}:down`}
                      disabled={index === draft.order.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
              <Locked label="Actions" />
            </ul>
            {prefs.error && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{prefs.error}</p>}
            <div className="flex items-center gap-2 border-t border-border/60 px-3 py-3">
              <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={(e) => void finish(prefs.reset, e.currentTarget)}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reset
              </Button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="button" size="sm" className="h-8" onClick={(e) => void finish(prefs.save, e.currentTarget)}>
                  {prefs.busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </fieldset>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">Loading…</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
