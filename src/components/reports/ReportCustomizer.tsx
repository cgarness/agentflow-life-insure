import React from "react";
import { ArrowDown, ArrowUp, Check, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_VISIBLE_STATS, REPORT_LAYOUT_GROUPS, REPORT_LAYOUT_SECTIONS, type SectionConfig } from "@/lib/report-layout-constants";

interface Props {
  editMode: boolean;
  sections: SectionConfig[];
  onSectionsChange: (sections: SectionConfig[]) => void;
  showTeamSections: boolean;
  busy: boolean;
  error: string | null;
  onSave: () => void | Promise<boolean>;
  onCancel: () => void;
  onReset: () => void | Promise<boolean>;
}

const SECTION_META = new Map(REPORT_LAYOUT_SECTIONS.map((section) => [section.id, section]));

const ReportCustomizer: React.FC<Props> = ({
  editMode, sections, onSectionsChange, showTeamSections, busy, error, onSave, onCancel, onReset,
}) => {
  const titleId = React.useId();
  const limitId = React.useId();
  if (!editMode) return null;
  const visibleStats = sections.filter((section) => section.visible && SECTION_META.get(section.id)?.group === "stats").length;

  const toggle = (id: string) => {
    const section = sections.find((item) => item.id === id);
    if (busy || !section) return;
    if (!section.visible && SECTION_META.get(id)?.group === "stats" && visibleStats >= MAX_VISIBLE_STATS) return;
    onSectionsChange(sections.map((item) => item.id === id ? { ...item, visible: !item.visible } : item));
  };

  const move = (id: string, neighborId: string | undefined) => {
    if (busy || !neighborId) return;
    const from = sections.findIndex((section) => section.id === id);
    const to = sections.findIndex((section) => section.id === neighborId);
    if (from < 0 || to < 0) return;
    const next = [...sections];
    [next[from], next[to]] = [next[to], next[from]];
    onSectionsChange(next);
  };

  return (
    <section aria-labelledby={titleId} aria-busy={busy} className="rounded-xl border border-primary/20 bg-card p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <Settings2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">Customize your report</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose metrics and reorder panels within each group. Only your report changes.</p>
          <p className="mt-1 text-xs text-muted-foreground">Production totals and trends stay visible.</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {REPORT_LAYOUT_GROUPS.map((group) => {
          const items = sections.filter((section) => SECTION_META.get(section.id)?.group === group.id);
          if (!items.length) return null;
          return (
            <fieldset key={group.id} disabled={busy} className="min-w-0" data-customizer-group={group.id}>
              <legend className="text-sm font-semibold">{group.label}</legend>
              {group.id === "stats" && (
                <p id={limitId} className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                  {visibleStats} of {MAX_VISIBLE_STATS} metrics selected. {visibleStats >= MAX_VISIBLE_STATS ? "Hide one to add another." : "Choose up to six metrics."}
                </p>
              )}
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {items.map((section, index) => {
                  const meta = SECTION_META.get(section.id)!;
                  const atLimit = group.id === "stats" && !section.visible && visibleStats >= MAX_VISIBLE_STATS;
                  return (
                    <li key={section.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 px-3 py-2" data-customizer-section={section.id}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" checked={section.visible} onChange={() => toggle(section.id)} disabled={busy || atLimit}
                          aria-label={`Show ${meta.label}`} aria-describedby={group.id === "stats" ? limitId : undefined}
                          className="h-4 w-4 shrink-0 accent-primary" />
                        <span className="min-w-0 break-words">
                          {meta.label}
                          {meta.teamOnly && !showTeamSections && <span className="mt-0.5 block text-xs text-muted-foreground">Team and Agency scopes only</span>}
                        </span>
                      </label>
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" size="icon" variant="ghost" aria-label={`Move ${meta.label} up`}
                          disabled={busy || index === 0} onClick={() => move(section.id, items[index - 1]?.id)}>
                          <ArrowUp aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" aria-label={`Move ${meta.label} down`}
                          disabled={busy || index === items.length - 1} onClick={() => move(section.id, items[index + 1]?.id)}>
                          <ArrowDown aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      <p className="mt-5 text-xs text-muted-foreground">Reset removes your saved layout and uses your agency default when available.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button type="button" variant="outline" disabled={busy} onClick={onReset} className="gap-2">
          <RotateCcw aria-hidden="true" className="h-4 w-4" />Reset to default
        </Button>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={onSave} className="gap-2">
            <Check aria-hidden="true" className="h-4 w-4" />{busy ? "Updating…" : "Save layout"}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default ReportCustomizer;
