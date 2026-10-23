import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  loadUplineCandidates,
  managerNamesById,
  type HierarchyPersonOption,
} from "@/lib/hierarchy/uplineCandidates";

/**
 * The member profile's upline select (hierarchy stabilization F2). A UI mirror, NOT
 * authorization: the database keeps `upline_id` Admin-only and (M2) rejects self, cycle and
 * cross-org uplines; those messages reach the save toast.
 *  - `canEdit` (Admin viewer): choices from `loadUplineCandidates` — Active Admins / Team
 *    Leaders of the organization, never the member or anyone beneath them, independent of
 *    the table filters. A current upline outside that set is a disabled "current" option. A
 *    load failure keeps the select disabled and says so (fail closed).
 *  - otherwise: read-only, labelled with the current upline's name (`managerNamesById`).
 */
interface Props {
  memberId: string;
  organizationId: string | null;
  /** The member's saved upline (the row the modal opened). */
  currentUplineId: string | null | undefined;
  /** The form value: an id, or null / "_none" for None. */
  value: string | null | undefined;
  onChange: (uplineId: string | null) => void;
  canEdit: boolean;
  disabled: boolean;
}

type Options = { candidates: HierarchyPersonOption[]; current: HierarchyPersonOption | null };

function loadOptions(p: Pick<Props, "memberId" | "organizationId" | "currentUplineId" | "canEdit">): Promise<Options> {
  const currentUplineId = p.currentUplineId || null;
  if (p.canEdit) {
    return loadUplineCandidates({ targetId: p.memberId, organizationId: p.organizationId, currentUplineId })
      .then((r) => ({ candidates: r.candidates, current: r.currentOutsideSet }));
  }
  if (!currentUplineId) return Promise.resolve({ candidates: [], current: null });
  return managerNamesById([currentUplineId], p.organizationId).then((names) => {
    const n = names[currentUplineId];
    return { candidates: [], current: { id: currentUplineId, firstName: n?.firstName ?? "", lastName: n?.lastName ?? "", role: null, status: n?.status ?? null } };
  });
}

function optionLabel(o: HierarchyPersonOption, current: boolean): string {
  const name = `${o.firstName} ${o.lastName}`.trim() || "Unknown member";
  const notes = [current ? "current" : "", o.status && o.status !== "Active" ? o.status : ""].filter(Boolean);
  return notes.length ? `${name} (${notes.join(", ")})` : name;
}

const UplinePicker: React.FC<Props> = ({ memberId, organizationId, currentUplineId, value, onChange, canEdit, disabled }) => {
  const key = `${memberId}|${organizationId ?? ""}|${currentUplineId ?? ""}|${canEdit}`;
  const [state, setState] = useState<{ key: string; options: Options | null; failed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadOptions({ memberId, organizationId, currentUplineId, canEdit })
      .then((options) => { if (!cancelled) setState({ key, options, failed: false }); })
      .catch((e) => {
        console.error("[UserManagement] upline choices failed:", e);
        if (!cancelled) setState({ key, options: null, failed: true });
      });
    return () => { cancelled = true; };
  }, [key, memberId, organizationId, currentUplineId, canEdit]);

  const ready = state?.key === key ? state : null;
  const options = ready?.options ?? null;
  const selected = value && value !== "_none" ? value : "_none";
  const known = new Set([...(options?.candidates ?? []).map((c) => c.id), options?.current?.id]);
  const placeholder = selected !== "_none" && !known.has(selected);

  return (
    <div>
      <Label>Upline Agent</Label>
      <Select value={selected} disabled={disabled || !canEdit || !options} onValueChange={v => onChange(v === "_none" ? null : v)}>
        <SelectTrigger aria-label="Upline Agent"><SelectValue placeholder="Select upline agent..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_none">None</SelectItem>
          {options?.current && <SelectItem value={options.current.id} disabled>{optionLabel(options.current, canEdit)}</SelectItem>}
          {placeholder && <SelectItem value={selected} disabled>{ready ? "Current upline" : "Loading…"}</SelectItem>}
          {(options?.candidates ?? []).map(c => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex items-center gap-2">
                {c.firstName} {c.lastName}
                <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">{c.role}</Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {ready?.failed && (
        <p className="text-xs text-destructive mt-1">Could not load upline choices, so the upline cannot be changed right now.</p>
      )}
    </div>
  );
};

export default UplinePicker;
