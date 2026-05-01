import React, { useEffect, useMemo, useState } from "react";

/**
 * Tear-off calendar styling for the app header — month bar + day in the body (blue accent).
 */
const HeaderDateCalendar: React.FC = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { monthLabel, day, ariaLabel } = useMemo(() => {
    const d = now;
    return {
      monthLabel: d.toLocaleString(undefined, { month: "long" }),
      day: d.getDate(),
      ariaLabel: `Today's date is ${d.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    };
  }, [now]);

  return (
    <div
      className="relative shrink-0 select-none"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Pushpin */}
      <div
        className="absolute left-1/2 z-30 -translate-x-1/2 -top-1 pointer-events-none"
        aria-hidden
      >
        <svg
          width="18"
          height="20"
          viewBox="0 0 18 20"
          className="drop-shadow-md"
        >
          {/* Head */}
          <ellipse cx="9" cy="5.5" rx="5.2" ry="5" fill="#93c5fd" />
          <ellipse cx="9" cy="5" rx="3.8" ry="3.7" fill="#3b82f6" />
          <ellipse cx="7.2" cy="4" rx="1.5" ry="1.3" fill="#bfdbfe" opacity="0.85" />
          {/* Shaft */}
          <path
            d="M9 10.5 L9 18.5 L7.8 17.9 L9 14.8 L10.2 17.9 L9 18.5Z"
            fill="#1d4ed8"
          />
          <path d="M8.2 10.8 L9 10.5 L9.8 10.8 L9 14.8 Z" fill="#2563eb" />
        </svg>
      </div>

      <div
        className="relative w-[70px] overflow-hidden rounded-sm border border-blue-950/15 bg-white shadow-[2px_3px_8px_rgba(15,23,42,0.18)]"
        style={{ marginTop: 4 }}
      >
        {/* Month bar */}
        <div className="relative h-[22px] bg-gradient-to-b from-blue-500 to-blue-600 text-[9px] font-semibold leading-none text-white flex items-center justify-center tracking-tight px-1 shadow-inner shadow-blue-950/20">
          {/* Dog-ear — darker underside of folded corner */}
          <span
            className="pointer-events-none absolute top-0 left-0 z-10 block size-0 border-r-[13px] border-b-[13px] border-r-transparent border-b-blue-900"
            aria-hidden
          />
          <span
            className="pointer-events-none absolute top-0 left-0 z-[11] block size-0 border-r-[9px] border-b-[9px] border-r-transparent border-b-blue-950/65"
            aria-hidden
          />
          <span className="relative z-20 truncate text-center max-w-[64px]" title={monthLabel}>
            {monthLabel}
          </span>
        </div>

        {/* Day */}
        <div className="flex h-[34px] items-center justify-center border-t border-blue-950/10 bg-white">
          <span className="text-[23px] font-bold leading-none tabular-nums text-slate-800">
            {day}
          </span>
        </div>
      </div>
    </div>
  );
};

export default HeaderDateCalendar;
