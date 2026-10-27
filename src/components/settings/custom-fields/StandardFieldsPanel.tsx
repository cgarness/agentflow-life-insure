import React, { useCallback, useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { provisionStandardLeadFields, StandardFieldsError, type StandardFieldsStatus } from "@/lib/standard-lead-fields";

const STATE_TEXT: Record<string, string> = {
  exists_agency: "Shared", created: "Shared", exists_personal: "Personal — make it agency-wide below", would_create: "Missing",
};

/**
 * Admin / Super Admin: the agency's standard lead fields (Address, City, ZIP Code). Shows the live state and any
 * failed automatic setup, and offers the idempotent retry that adds only the missing agency-wide fields. Hidden when
 * the feature is not deployed (the database function does not exist yet).
 */
const StandardFieldsPanel: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [status, setStatus] = useState<StandardFieldsStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await provisionStandardLeadFields(true)); setError(null); } catch (e) {
      if (e instanceof StandardFieldsError && (e.code === "unavailable" || e.code === "not_permitted")) setHidden(true);
      else setError(e instanceof Error ? e.message : "Couldn't load the standard fields.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (hidden) return null;
  const missing = status?.fields.filter((f) => f.state === "would_create") ?? [];
  const add = async () => {
    setBusy(true);
    try {
      const r = await provisionStandardLeadFields(false);
      setStatus(r);
      toast.success(missing.length === 1 ? `${missing[0].name} added for your agency` : "Standard fields added for your agency");
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't add the standard fields."); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 rounded-xl border bg-card p-4" aria-label="Standard lead fields">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4" aria-hidden /> Standard lead fields</p>
          <p className="text-xs text-muted-foreground">Address, City and ZIP Code are shared by everyone in your agency (Google Sheets, imports and lead details).</p>
        </div>
        {missing.length > 0 && <Button size="sm" onClick={add} disabled={busy}>Add {missing.length === 1 ? missing[0].name : "missing fields"}</Button>}
      </div>
      {status && (
        <ul className="flex flex-wrap gap-2">
          {status.fields.map((f) => (
            <li key={f.key} className="rounded border px-2 py-0.5 text-xs">
              {f.name}: <span className={f.state === "exists_agency" || f.state === "created" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                {STATE_TEXT[f.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {status?.last_attempt?.status === "failed" && (
        <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
          Automatic setup didn't finish when your agency was created (code {status.last_attempt.last_error ?? "unknown"}). Adding the missing fields completes it.
        </p>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
};

export default StandardFieldsPanel;
