import React from "react";

interface TVTickerProps {
  live: boolean;
  tickerText: string;
  tickerTimeDisplay: string;
}

/** Footer news ticker: the banner or the wins feed, plus the agency-time day and time. */
const TVTicker: React.FC<TVTickerProps> = ({ live, tickerText, tickerTimeDisplay }) => (
  <footer className="shrink-0 h-12 border-t border-white/5 bg-black/70 backdrop-blur-xl flex items-center overflow-hidden">
    <div className="relative w-full h-full flex items-center overflow-hidden">
      <div className="animate-ticker whitespace-nowrap flex items-center min-w-max">
        {[1, 2, 3, 4].map((group) => (
          <div key={group} className="flex items-center gap-10 px-10">
            <span className="text-blue-400 font-black uppercase tracking-[0.25em] text-xs px-5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 shrink-0">
              {live ? "LIVE NEWS FEED" : "NEWS FEED"}
            </span>
            <span className="text-sm font-bold text-slate-200 tracking-wide uppercase">
              {tickerText}
            </span>
            <span className="text-blue-500 opacity-40 text-lg">•</span>
            <span className="text-sm font-bold text-slate-400 tracking-wide uppercase">
              {tickerTimeDisplay}
            </span>
            <span className="text-blue-500 opacity-40 text-lg">•</span>
          </div>
        ))}
      </div>
    </div>
  </footer>
);

export default TVTicker;
