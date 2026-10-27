import React, { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { makeCustomFieldAgencyWide, type AgencyWideImpact } from "@/lib/standard-lead-fields";

interface Props { field: { id: string; name: string }; currentUserId: string | null; onClose: () => void; onDone: () => void }

/** Typed confirmation (Zod): the exact field name. */
export const agencyWideConfirmSchema = (name: string) =>
  z.object({ confirm: z.string().refine((v) => v.trim() === name.trim(), { message: `Type ${name} to confirm` }) });

/**
 * Makes one personal custom field agency-wide. Reviews the impact first (server dry run), then applies only if the
 * field is unchanged (snapshot). Audited on the server; lead data is never changed.
 */
const MakeAgencyWideDialog: React.FC<Props> = ({ field, currentUserId, onClose, onDone }) => {
  const [impact, setImpact] = useState<AgencyWideImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    makeCustomFieldAgencyWide(field.id, null, true)
      .then((r) => { if (live) setImpact(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Couldn't review this field."); });
    return () => { live = false; };
  }, [field.id]);

  const apply = async () => {
    if (!impact) return;
    const parsed = agencyWideConfirmSchema(impact.field.name).safeParse({ confirm });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); setError(null);
    try {
      await makeCustomFieldAgencyWide(field.id, impact.snapshot, false);
      toast.success(`${impact.field.name} is now shared with your agency`);
      onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update this field."); } finally { setBusy(false); }
  };

  const owner = impact ? (impact.owner.id === currentUserId ? "you" : impact.owner.name || "another user") : "";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Make “{field.name}” agency-wide?</DialogTitle></DialogHeader>
        {!impact && !error && <Skeleton className="h-24 w-full" />}
        {impact && (
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Everyone in your agency will see and can use this {impact.field.type} field. Today it belongs to {owner}.</li>
              <li>Only Admins will be able to edit or delete it afterwards.</li>
              <li>{impact.leads_with_key} lead{impact.leads_with_key === 1 ? "" : "s"} already hold a value. No lead data changes.</li>
              {impact.other_personal_rows > 0 && <li>{impact.other_personal_rows} other personal field{impact.other_personal_rows === 1 ? "" : "s"} with this name stay as they are.</li>}
            </ul>
            <div className="space-y-1">
              <Label htmlFor="gs-agency-confirm" className="text-xs">Type <span className="font-medium">{impact.field.name}</span> to confirm</Label>
              <Input id="gs-agency-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </div>
          </div>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={apply} disabled={busy || !impact || confirm.trim() !== impact.field.name.trim()}>Make agency-wide</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MakeAgencyWideDialog;
