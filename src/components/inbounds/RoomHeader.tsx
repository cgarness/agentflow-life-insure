import { Headphones, ExternalLink } from "lucide-react";
import { button } from "./styles";
export function RoomHeader() {
  return (
    <header className="border-b border-slate-700 bg-slate-900/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-300/15 p-3 text-emerald-300">
            <Headphones className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">
              AgentFlow · Inbounds
            </p>
            <h1 className="text-2xl font-bold text-white">The inbound room</h1>
          </div>
          <span className="rounded-full border border-violet-400/60 bg-violet-400/10 px-3 py-1 text-xs font-bold text-violet-200">
            Pilot
          </span>
        </div>
        <a href="/dashboard" className={button + " flex items-center gap-2"}>
          Back to AgentFlow
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </header>
  );
}
