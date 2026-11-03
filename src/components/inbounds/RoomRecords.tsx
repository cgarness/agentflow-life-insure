import { useState } from "react";
import type { RoomSnapshot } from "@/lib/inbounds/contracts";
import { VoicemailPlayer } from "@/components/voicemail/VoicemailPlayer";
import { panel, button } from "./styles";
export function RoomRecords({ data }: { data: RoomSnapshot }) {
  const [tab, setTab] = useState<"missed" | "voicemail" | "agents">("missed");

  const rows = tab === "missed" ? data.missed : data.voicemail_calls;
  return (
    <section className={panel + " p-5"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Room activity</h2>
        <div className="flex flex-wrap gap-2" aria-label="Activity views">
          {(data.admin
            ? (["missed", "voicemail", "agents"] as const)
            : (["missed", "voicemail"] as const)
          ).map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={
                button +
                (tab === t ? " border-blue-300 bg-blue-950 text-blue-200" : "")
              }
              onClick={() => setTab(t)}
            >
              {t === "missed"
                ? "Missed calls"
                : t === "voicemail"
                  ? "Voicemail"
                  : "Agents"}
            </button>
          ))}
        </div>
      </div>
      {tab === "agents" ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-200">
              <tr>
                <th className="py-3">Agent</th>
                <th>Answered</th>
                <th>Dispositioned</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr className="border-t border-slate-700" key={a.id}>
                  <td className="py-4 text-white">{a.name}</td>
                  <td className="text-emerald-300">{a.answered}</td>
                  <td className="text-blue-300">{a.dispositioned}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.agents.length && (
            <p className="py-6 text-slate-300">No answered room calls today.</p>
          )}
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-700">
          {rows.map((c) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 py-4"
              key={c.id}
            >
              <div>
                <p className="font-semibold text-white">
                  {c.contact_name || c.contact_phone || "Unknown caller"}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  {c.contact_name && c.contact_phone
                    ? c.contact_phone + " · "
                    : ""}
                  {new Date(c.created_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {tab === "voicemail" && c.voicemail_id && (
                <VoicemailPlayer voicemailId={c.voicemail_id} compact />
              )}
            </div>
          ))}
          {!rows.length && (
            <p className="py-6 text-slate-300">
              No {tab === "missed" ? "missed calls" : "voicemails"} today.
            </p>
          )}
          <p className="pt-4 text-xs text-slate-300">
            Latest 50 records today. Calls are counted once, even when several
            agents ring.
          </p>
        </div>
      )}
    </section>
  );
}
