import type { RoomSnapshot } from "@/lib/inbounds/contracts";
import { panel } from "./styles";
export function RoomStats({ data }: { data: RoomSnapshot }) {
  const metrics = data.admin
    ? [
        [
          "Inbound calls",
          data.stats.total,
          "text-blue-300",
          "border-t-blue-300",
        ],
        [
          "Answered",
          data.stats.answered,
          "text-emerald-300",
          "border-t-emerald-300",
        ],
        ["Missed", data.stats.missed, "text-amber-300", "border-t-amber-300"],
        [
          "Voicemails",
          data.stats.voicemails,
          "text-violet-300",
          "border-t-violet-300",
        ],
      ]
    : [
        [
          "My answered calls",
          data.stats.answered,
          "text-emerald-300",
          "border-t-emerald-300",
        ],
        [
          "Awaiting disposition",
          data.stats.pending,
          "text-amber-300",
          "border-t-amber-300",
        ],
      ];
  return (
    <section aria-label="Today's performance" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-white">
          {data.admin ? "Agency overview" : "My performance"}
        </h2>
        <span className="text-sm text-slate-300">Today · your timezone</span>
      </div>
      <div
        className={
          "grid grid-cols-2 gap-3 " + (data.admin ? "lg:grid-cols-4" : "")
        }
      >
        {metrics.map(([label, value, color, accent]) => (
          <div
            className={panel + " min-w-0 border-t-2 p-5 " + accent}
            key={label}
          >
            <p className="text-sm font-medium text-slate-200">{label}</p>
            <p className={"mt-2 text-4xl font-bold tabular-nums " + color}>
              <span
                key={value}
                className="inline-block motion-safe:animate-stat-bump"
              >
                {value}
              </span>
            </p>
          </div>
        ))}
      </div>
      <div className={panel + " p-5"}>
        <h3 className="font-bold text-white">Disposition counts</h3>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
          {data.outcomes.length ? (
            data.outcomes.map((o) => (
              <div
                key={o.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-blue-400/25 bg-blue-950/30 px-4 py-3"
              >
                <span className="min-w-0 break-words text-sm text-slate-100">
                  {o.name}
                </span>
                <strong
                  key={o.count}
                  className="shrink-0 text-xl tabular-nums text-blue-300 motion-safe:animate-stat-bump"
                >
                  {o.count}
                </strong>
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
