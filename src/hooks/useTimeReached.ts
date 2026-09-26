import { useEffect, useState } from "react";

/**
 * True once `at` (epoch ms) has passed; one timer re-renders at that moment —
 * no ticking. `null` means "no wait".
 */
export function useTimeReached(at: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null || at <= Date.now()) return;
    const id = window.setTimeout(() => setNow(Date.now()), at - Date.now() + 50);
    return () => window.clearTimeout(id);
  }, [at]);
  return at === null || at <= Math.max(now, Date.now());
}
