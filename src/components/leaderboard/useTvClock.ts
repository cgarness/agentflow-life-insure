import { useCallback, useEffect, useState } from "react";

/** Format a Date using the agency's IANA timezone */
function formatInTz(date: Date, timezone: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(date);
  }
}

/** The TV clock in the agency time zone, ticking every second. */
export function useTvClock(timezone: string) {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const formatTvTime = useCallback(
    (ms: number) => formatInTz(new Date(ms), timezone, { hour: "numeric", minute: "2-digit", hour12: true }),
    [timezone],
  );

  return {
    formatTvTime,
    clockDisplay: formatInTz(clock, timezone, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }),
    tickerTimeDisplay: formatInTz(clock, timezone, { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }),
  };
}
