import { Badge } from "@/components/ui/badge";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { useInboundCallbacks } from "@/hooks/useInboundCallbacks";
import type { InboundCallback } from "@/lib/inbounds/contracts";
import { button, panel, primary, textButton } from "./styles";

const time = (value: string) => new Date(value).toLocaleString([], {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});

function holder(item: InboundCallback) {
  if (item.status === "open") return "Open";
  return item.claimed_by_me ? "Claimed by you" : "Claimed by " + (item.claimed_by_name || "another agent");
}
// A state, not an action: shown as a status badge so "Open" never reads as a button label.
const tone = (item: InboundCallback) => item.status === "open" ? "info" : "neutral";

/**
 * Callbacks that automations opened for missed inbound calls. An agent claims one, calls back from
 * their own dialer and marks it done. This list never places a call.
 */
export function RoomCallbacks() {
  const callbacks = useInboundCallbacks();
  const open = callbacks.items.filter(item => item.status === "open").length;
  return (
    <section aria-labelledby="room-callbacks-title" className={panel + " p-5"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="room-callbacks-title" className="text-lg font-bold text-white">
          Callbacks{callbacks.loaded && <span className="ml-2 text-sm font-semibold text-slate-300">{open} open</span>}
        </h2>
        <button type="button" className={textButton + " text-sm text-slate-200"} onClick={() => { void callbacks.refresh(); }}>
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-300">Automations open these for missed calls to any agency number, not only the room's lines.</p>
      {callbacks.notice && <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-950 px-3 py-2 text-sm text-amber-100">
        {callbacks.notice}
      </p>}
      {callbacks.error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-400 bg-rose-950 px-3 py-2 text-sm text-rose-100">
        <span>{callbacks.error}</span>
        <button type="button" className={button} onClick={() => { void callbacks.refresh(); }}>Retry</button>
      </div>}
      {!callbacks.loaded && !callbacks.error && <p role="status" className="py-6 text-slate-300">Loading callbacks…</p>}
      {callbacks.loaded && !callbacks.items.length && <p className="py-6 text-slate-300">No callbacks waiting.</p>}
      <ul className="mt-2 divide-y divide-slate-700">
        {callbacks.items.map(item => {
          const pressed = callbacks.busy?.id === item.id ? callbacks.busy.action : null;
          const mine = item.status === "claimed" && item.claimed_by_me;
          const others = item.status === "claimed" && !item.claimed_by_me;
          const caller = item.contact_name || item.caller_phone || "unknown caller";
          return (
            // Side by side from 640 px; stacked and left-aligned on a phone.
            <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-white">{item.contact_name || item.caller_phone || "Unknown caller"}</p>
                {/* Selectable, so the agent can copy the number into their own dialer. */}
                {item.contact_name && item.caller_phone && <p className="select-all text-sm text-slate-200">{item.caller_phone}</p>}
                <p className="text-sm text-slate-300">
                  Missed {time(item.missed_at)}{item.due_at ? " · Call back by " + time(item.due_at) : ""}
                </p>
                <p className="text-sm text-slate-200">{item.title}</p>
                {item.notes && <p className="whitespace-pre-wrap text-sm text-slate-300">{item.notes}</p>}
                {item.voicemail_id && <VoicemailPlayer voicemailId={item.voicemail_id} compact/>}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <Badge variant={tone(item)}>{holder(item)}</Badge>
                {/* While any action is saving, every row waits, so a press is never dropped without a sign. */}
                <div className="flex flex-wrap gap-2 sm:justify-end" aria-busy={pressed !== null}>
                  {item.status === "open" && item.can_claim && <button type="button" className={primary} disabled={!!callbacks.busy}
                    aria-label={"Claim callback for " + caller}
                    onClick={() => { void callbacks.claim(item); }}>{pressed === "claim" ? "Claiming…" : "Claim"}</button>}
                  {mine && <button type="button" className={primary} disabled={!!callbacks.busy}
                    aria-label={"Done with callback for " + caller}
                    onClick={() => { void callbacks.complete(item); }}>{pressed === "complete" ? "Saving…" : "Done"}</button>}
                  {(mine || (others && callbacks.admin)) && <button type="button" className={button} disabled={!!callbacks.busy}
                    aria-label={"Release callback for " + caller}
                    onClick={() => { void callbacks.release(item); }}>{pressed === "release" ? "Releasing…" : "Release"}</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {callbacks.loaded && callbacks.items.length > 0 && <p className="pt-3 text-xs text-slate-300">
        Claim a callback, call back from your dialer, then mark it done. Up to 100 are shown, newest first.
      </p>}
    </section>
  );
}
