import type { RoomSnapshot } from "@/lib/inbounds/contracts";
import { panel } from "./styles";
export function RoomStats({ data }: { data: RoomSnapshot }) {
  const metrics = data.admin
    ? [
        ["Inbound calls", data.stats.total, "text-white"],
        ["Answered", data.stats.answered, "text-emerald-300"],
        ["Missed", data.stats.missed, "text-amber-300"],
        ["Voicemails", data.stats.voicemails, "text-violet-300"],
      ]
    : [
        ["My answered calls", data.stats.answered, "text-emerald-300"],
        ["Awaiting disposition", data.stats.pending, "text-amber-300"],
      ];
  return (
    <section aria-label="Today's performance" className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-white">
          {data.admin ? "Agency overview" : "My performance"}
        </h2>
        <span className="text-sm text-slate-300">Today · your timezone</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(([label, value, color]) => (
          <div className={panel + " p-5"} key={label}>
            <p className="text-sm font-medium text-slate-200">{label}</p>
            <p className={"mt-2 text-4xl font-bold tabular-nums " + color}>
              {value}
            </p>
          </div>
        ))}
      </div>
      <div className={panel + " p-5"}>
        <h3 className="font-bold text-white">Disposition counts</h3>
        <div className="mt-4 flex flex-wrap gap-3">
          {data.outcomes.length ? (
            data.outcomes.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-4 rounded-lg border border-slate-600 bg-slate-950/50 px-4 py-3"
              >
                <span className="text-sm text-slate-100">{o.name}</span>
                <strong className="text-xl text-blue-300">{o.count}</strong>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-300">
              No outcomes configured in Settings.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
