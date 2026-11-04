import { RoomContact } from "./RoomContact";
import { LockKeyhole } from "lucide-react";
import type { RoomCall } from "@/lib/inbounds/contracts";
import type { useFloatingDialerDispositions } from "@/hooks/useFloatingDialerDispositions";
import { useRoomDisposition } from "@/hooks/useRoomDisposition";
import ConvertLeadModal from "@/components/contacts/ConvertLeadModal";
import RecordPolicyModal from "@/components/contacts/RecordPolicyModal";
import { panel, field, primary, button } from "./styles";
type Config = ReturnType<typeof useFloatingDialerDispositions>;
export function RoomDisposition({
  call,
  org,
  config,
  onSaved,
}: {
  call: RoomCall;
  org: string;
  config: Config;
  onSaved: () => Promise<void>;
}) {
  const {
    completeSale,
    selected,
    setSelected,
    notes,
    setNotes,
    dueAt,
    setDueAt,
    title,
    setTitle,
    error,
    saving,
    lead,
    setLead,
    policy,
    setPolicy,
    disp,
    save,
  } = useRoomDisposition(call, org, config, onSaved);
  return (
    <section
      className={panel + " border-amber-300/70 p-5"}
      aria-label="Required call disposition"
    >
      <div className="flex gap-3">
        <LockKeyhole className="mt-1 h-5 w-5 text-amber-300" />
        <div>
          <h2 className="text-lg font-bold text-white">
            {call.ended_at ? "Finish this call" : "Call in progress"}
          </h2>
          <p className="mt-1 text-sm text-amber-200">
            Save a disposition before you can receive another call.
          </p>
        </div>
      </div>
      <p className="my-4 font-semibold text-white">
        {call.contact_name || call.contact_phone || "Inbound caller"}
      </p>
      {!call.contact_id && call.ended_at && (
        <RoomContact callId={call.id} onSaved={onSaved} />
      )}
      {config.status !== "ready" ? (
        <p role="alert">
          Outcomes unavailable.{" "}
          <button className={button} onClick={config.retry}>
            Reload outcomes
          </button>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <fieldset
            disabled={saving || !call.ended_at || !!lead || !!policy}
            className="space-y-4 disabled:opacity-60"
          >
            <label className="block text-sm text-slate-100">
              Call outcome
              <select
                className={field + " mt-2"}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                }}
                required
              >
                <option value="">Select a disposition</option>
                {config.dispositions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-slate-100">
              Notes{disp?.require_notes ? " (required)" : ""}
              <textarea
                className={field + " mt-2 min-h-28"}
                value={notes}
                maxLength={10000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {(disp?.callback_scheduler || disp?.appointment_scheduler) && (
              <label className="block text-sm">
                {disp.appointment_scheduler ? "Appointment" : "Callback"} · your
                timezone
                <input
                  type="datetime-local"
                  className={field + " mt-2"}
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  required
                />
              </label>
            )}
            {disp?.appointment_scheduler && (
              <label className="block text-sm">
                Appointment title
                <input
                  className={field + " mt-2"}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
            )}
            <button className={primary + " w-full"} type="submit">
              {saving ? "Saving…" : "Save disposition"}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="mt-4 text-sm text-rose-200" role="alert">
          {error}
        </p>
      )}
      {lead && (
        <ConvertLeadModal
          open
          lead={lead}
          onClose={() => setLead(null)}
          onSuccess={completeSale}
        />
      )}
      {policy && (
        <RecordPolicyModal
          open
          clientId={policy.id}
          primary={policy.primary}
          onClose={() => setPolicy(null)}
          onSaved={() => {
            const id = policy.id;
            completeSale(id);
          }}
        />
      )}
    </section>
  );
}
