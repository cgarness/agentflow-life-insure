/**
 * Dashboard attention clearances release switch (Polish V2 plan §3.4).
 *
 * `VITE_DASHBOARD_ATTENTION_CLEARANCES=true` turns on Clear / Undo / the Cleared view for Missed
 * Calls and Callbacks. It may only be set once the `dashboard_attention_clearances` migration (G3)
 * is applied and read back. Until then no clearance is read, no action is rendered, and every
 * callback and missed-call query is exactly what it was before this feature.
 *
 * Fails closed: anything but the exact string "true" is off.
 */
export interface AttentionConfig {
  clearancesEnabled: boolean;
}

interface AttentionEnv {
  VITE_DASHBOARD_ATTENTION_CLEARANCES?: string;
}

export function parseAttentionConfig(env: AttentionEnv): AttentionConfig {
  return { clearancesEnabled: env.VITE_DASHBOARD_ATTENTION_CLEARANCES === "true" };
}

export const ATTENTION_CONFIG: AttentionConfig = parseAttentionConfig(import.meta.env as AttentionEnv);
