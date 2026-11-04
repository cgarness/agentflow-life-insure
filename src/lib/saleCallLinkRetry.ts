import { supabase } from "@/integrations/supabase/client";

/**
 * Bounded recovery of a producing-call link whose capture failed and was recorded by the server (Reports V2 PKG-C,
 * D3 §2.12). Module-level, so it is independent of any modal's lifecycle: 3 attempts at 1 s, 4 s and 15 s through
 * retry_policy_sale_call_link, deduplicated per sale, stopping on a final answer. If all fail, the policy section
 * offers "Call link not saved · Retry" after any reload. A missing link is always Unclassified, never "No".
 */
export const SALE_CALL_LINK_RETRY_DELAYS_MS = [1000, 4000, 15000] as const;
const FINAL = new Set(["linked", "already_linked", "rejected", "no_open_failure", "disabled"]);
const inFlight = new Map<string, Promise<string | null>>();

export type RetryStatus = "linked" | "already_linked" | "rejected" | "no_open_failure" | "disabled" | "capture_failed" | "unknown";

export async function retrySaleCallLink(winId: string): Promise<RetryStatus> {
  try {
    const { data, error } = await (supabase as any).rpc("retry_policy_sale_call_link", { p_win_id: winId });
    if (error) return "unknown";
    const status = data && typeof data === "object" ? (data as { status?: unknown }).status : null;
    return typeof status === "string" && (FINAL.has(status) || status === "capture_failed") ? status as RetryStatus : "unknown";
  } catch {
    return "unknown";
  }
}

type Deps = { retry: (winId: string) => Promise<RetryStatus>; sleep: (ms: number) => Promise<void> };
const defaultDeps: Deps = { retry: retrySaleCallLink, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** Schedules the bounded retry for each sale; a sale already being retried is not scheduled twice. */
export function scheduleSaleCallLinkRetry(winIds: readonly string[], deps: Deps = defaultDeps): Promise<Array<string | null>> {
  return Promise.all(winIds.map((winId) => {
    const running = inFlight.get(winId);
    if (running) return running;
    const run = (async () => {
      let last: string | null = null;
      for (const delay of SALE_CALL_LINK_RETRY_DELAYS_MS) {
        await deps.sleep(delay);
        last = await deps.retry(winId);
        if (FINAL.has(last)) break;
      }
      return last;
    })().finally(() => inFlight.delete(winId));
    inFlight.set(winId, run);
    return run;
  }));
}
