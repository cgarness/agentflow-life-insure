import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CarrierResourceErrors, CarrierResourceLink } from "@/lib/carrierResources";

interface Props {
  links: CarrierResourceLink[];
  onChange: (links: CarrierResourceLink[]) => void;
  disabled?: boolean;
  errors?: CarrierResourceErrors;
}

export default function CarrierResourceLinksEditor({ links, onChange, disabled = false, errors = {} }: Props) {
  const update = (id: string, patch: Partial<CarrierResourceLink>) => {
    if (!disabled) onChange(links.map((link) => link.id === id ? { ...link, ...patch } : link));
  };
  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (disabled || nextIndex < 0 || nextIndex >= links.length) return;
    const next = [...links];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };
  const add = () => {
    if (!disabled && links.length < 50) {
      onChange([...links, { id: crypto.randomUUID(), label: "", url: "", group: "quick_links" }]);
    }
  };

  return (
    <fieldset disabled={disabled} aria-label="Carrier resource links" className="min-w-0 space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Resource links</h3>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled || links.length >= 50}>
          <Plus className="h-4 w-4" aria-hidden="true" />Add link
        </Button>
      </div>
      {links.length === 0 && <p className="text-xs text-muted-foreground">Add application, guide, or training links.</p>}
      {links.map((link, index) => {
        const prefix = `carrier-resource-${link.id}`;
        const rowErrors = errors[link.id] ?? {};
        return (
          <div key={link.id} className="min-w-0 space-y-3 rounded-lg border border-border bg-background/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Link {index + 1}</span>
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11" disabled={disabled || index === 0}
                  aria-label={`Move link ${index + 1} up`} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11" disabled={disabled || index === links.length - 1}
                  aria-label={`Move link ${index + 1} down`} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                <Button type="button" size="icon" variant="ghost" className="h-11 w-11 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove link ${index + 1}`} onClick={() => { if (!disabled) onChange(links.filter((row) => row.id !== link.id)); }}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`${prefix}-label`}>Label</Label>
                <Input id={`${prefix}-label`} value={link.label} placeholder="Underwriting guide"
                  aria-invalid={!!rowErrors.label} aria-describedby={rowErrors.label ? `${prefix}-label-error` : undefined}
                  onChange={(event) => update(link.id, { label: event.target.value })} />
                {rowErrors.label && <p id={`${prefix}-label-error`} className="text-xs text-destructive">{rowErrors.label}</p>}
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`${prefix}-group`}>Group</Label>
                <select id={`${prefix}-group`} value={link.group}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 sm:text-sm"
                  aria-invalid={!!rowErrors.group} aria-describedby={rowErrors.group ? `${prefix}-group-error` : undefined}
                  onChange={(event) => update(link.id, { group: event.target.value as CarrierResourceLink["group"] })}>
                  <option value="quick_links">Quick links</option>
                  <option value="guides_training">Guides &amp; training</option>
                </select>
                {rowErrors.group && <p id={`${prefix}-group-error`} className="text-xs text-destructive">{rowErrors.group}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${prefix}-url`}>URL</Label>
              <Input id={`${prefix}-url`} type="url" value={link.url} placeholder="https://…" autoComplete="off"
                aria-invalid={!!rowErrors.url} aria-describedby={rowErrors.url ? `${prefix}-url-error` : undefined}
                onChange={(event) => update(link.id, { url: event.target.value })} />
              {rowErrors.url && <p id={`${prefix}-url-error`} className="text-xs text-destructive">{rowErrors.url}</p>}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
