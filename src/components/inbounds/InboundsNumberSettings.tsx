import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { PhoneNumberRow } from "@/components/settings/phone/NumberManagementSection";
import { setRoomNumber } from "@/lib/inbounds/api";
import { INBOUNDS_ENABLED } from "@/lib/inbounds/contracts";
export function InboundsNumberSettings({
  org,
  numbers,
  onRefresh,
}: {
  org: string | null;
  numbers: PhoneNumberRow[];
  onRefresh: () => Promise<void>;
}) {
  const { realProfile, isImpersonating } = useAuth(),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  if (
    !INBOUNDS_ENABLED ||
    isImpersonating ||
    !org ||
    realProfile?.organization_id !== org ||
    !["Admin", "Super Admin"].includes(realProfile.role)
  )
    return null;
  return (
    <section className="mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-5">
      <h3 className="text-lg font-semibold">Inbounds-only numbers</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Dedicated numbers ring agents in the Inbounds room. They are excluded
        from the CRM ring group and outbound caller ID. Default, personal and
        direct-line numbers cannot be selected.
      </p>
      <div className="mt-4 divide-y divide-border">
        {numbers.map((n) => {
          const eligible =
            n.assignment_type === "agency" &&
            !n.is_default &&
            !n.is_direct_line &&
            n.status?.toLowerCase() === "active";
          return (
            <label
              key={n.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <span>
                {n.friendly_name || n.phone_number}
                {n.friendly_name && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    {n.phone_number}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!n.inbounds_only}
                  disabled={!!busy || (!eligible && !n.inbounds_only)}
                  aria-label={"Use " + n.phone_number + " for Inbounds only"}
                  onChange={async (e) => {
                    setBusy(n.id);
                    setError("");
                    try {
                      await setRoomNumber(n.id, e.target.checked);
                      await onRefresh();
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Routing was not saved",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
                {busy === n.id
                  ? "Saving…"
                  : n.inbounds_only
                    ? "Inbounds only"
                    : "Use for Inbounds"}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
