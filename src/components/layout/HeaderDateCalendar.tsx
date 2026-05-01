import React, { useEffect, useMemo, useState } from "react";

/**
 * Compact calendar chip for the header — matches Quick Add (w-8 h-8): solid blue month bar, white day.
 */
const HeaderDateCalendar: React.FC = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { monthShort, monthFull, day, ariaLabel } = useMemo(() => {
    const d = now;
    return {
      monthShort: d.toLocaleString(undefined, { month: "short" }),
      monthFull: d.toLocaleString(undefined, { month: "long" }),
      day: d.getDate(),
      ariaLabel: `Today's date is ${d.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`,
    };
  }, [now]);

  const monthTitle = `${monthFull} ${day}`;

  return (
    <div
      className="flex h-8 w-8 shrink-0 flex-col overflow-hidden rounded-lg border border-blue-700/35 bg-white shadow-sm select-none"
      role="img"
      aria-label={ariaLabel}
    >
      <div className="flex h-[11px] shrink-0 items-center justify-center bg-blue-600 px-0.5 text-[7px] font-semibold leading-none text-white">
        <span className="truncate" title={monthTitle}>
          {monthShort}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-white text-[15px] font-bold leading-none tabular-nums text-slate-900">
        {day}
      </div>
    </div>
  );
};

export default HeaderDateCalendar;
