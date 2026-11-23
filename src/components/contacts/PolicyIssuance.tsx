import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { confirmPolicyIssuance, EARLIEST_ISSUE_DATE, getPolicyIssuance, issueDateSchema, PolicyIssuanceError } from "@/lib/policyIssuance";
import { todayLocalDateInput } from "@/lib/taskDates";

const STALE = new Set(["PT409", "PT404", "42501"]);

interface Props {
  clientId: string;
  /** The stored identity of the one policy this confirms. */
  policyId: string;
  formatDate: (value: string) => string;
}

/**
 * Issuance for one policy: shown once confirmed, and offered to the people who may confirm it.
 * Renders nothing while loading, after a failed lookup, or when there is nothing to show or do.
 */
export default function PolicyIssuance({clientId, policyId, formatDate}: Props) {
  const id = useId();
  const {isImpersonating} = useAuth();
  const cache = useQueryClient();
  const key = ["policy-issuance", clientId];
  const issuance = useQuery({queryKey: key, queryFn: () => getPolicyIssuance(clientId), staleTime: 30_000, retry: false});
  const [open, setOpen] = useState(false);
  const [issuedOn, setIssuedOn] = useState("");
  const [problem, setProblem] = useState("");
  // One request ID per opening of the dialog, so pressing Confirm again after a lost reply repeats the same request.
  const request = useRef("");
  const confirm = useMutation({
    mutationFn: (date: string) => confirmPolicyIssuance(request.current, policyId, date),
    onSuccess: async () => { await cache.invalidateQueries({queryKey: key}); setOpen(false); },
    onError: (failure) => {
      setProblem(failure instanceof Error ? failure.message : "Issuance was not confirmed. Try again.");
      // Already confirmed elsewhere, gone, or no longer allowed: the status shown is out of date, so read it again.
      if (failure instanceof PolicyIssuanceError && STALE.has(failure.code)) void cache.invalidateQueries({queryKey: key});
    },
  });
  const entry = issuance.data?.find(item => item.policy_id === policyId);
  // Viewing as someone else is read-only. The server refuses the confirmation as well.
  const confirmable = !!entry && !entry.issued_on && entry.can_confirm && !isImpersonating;
  const issued = entry?.issued_on ? <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
    <Badge variant="success">Issued</Badge>
    <span>{formatDate(entry.issued_on)}{entry.confirmed_by_name ? " · confirmed by " + entry.confirmed_by_name : ""}</span>
  </p> : null;
  // An open dialog stays until it is closed, so a refusal can still be read after the status behind it is refreshed.
  if (!issued && !confirmable && !open) return null;

  function start() {
    request.current = crypto.randomUUID();
    setIssuedOn(todayLocalDateInput()); setProblem(""); confirm.reset(); setOpen(true);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (confirm.isPending || !confirmable) return;
    const checked = issueDateSchema.safeParse(issuedOn);
    if (!checked.success) { setProblem(checked.error.issues[0].message); return; }
    setProblem("");
    confirm.mutate(checked.data);
  }
  return <div className="mt-2">
    {issued ?? (confirmable && <Button type="button" variant="outline" size="sm" className="h-11 text-xs md:h-8" onClick={start}>
      Confirm issuance
    </Button>)}
    <Dialog open={open} onOpenChange={next => { if (!confirm.isPending) setOpen(next); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Confirm policy issuance</DialogTitle>
            <DialogDescription>
              Confirm only once the carrier has issued this policy. A recorded sale or an effective date is not issuance.
              A confirmation cannot be edited afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={id}>Issue date</Label>
            <Input id={id} type="date" required min={EARLIEST_ISSUE_DATE} max={todayLocalDateInput()} value={issuedOn} disabled={confirm.isPending}
              aria-invalid={!!problem || undefined} aria-describedby={problem ? id + "-error" : undefined}
              onChange={event => { setIssuedOn(event.target.value); setProblem(""); }}/>
            {problem && <p id={id + "-error"} role="alert" className="text-sm text-badge-error-text">{problem}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-11 md:h-10" disabled={confirm.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="h-11 md:h-10" disabled={confirm.isPending || !confirmable}>
              {confirm.isPending ? "Confirming…" : "Confirm issuance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
