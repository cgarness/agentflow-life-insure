/**
 * Canonical Supabase project ref for this repo (subdomain before `.supabase.co`).
 * Must match Vercel / local `VITE_SUPABASE_URL` or JWT + Edge calls will 401.
 */
export const AGENTFLOW_SUPABASE_PROJECT_REF = "jncvvsvckxhqgqvkppmj";

/** Log once if the configured URL does not point at the expected project. */
export function warnIfSupabaseUrlHostMismatch(): void {
  const raw = import.meta.env.VITE_SUPABASE_URL;
  if (typeof raw !== "string" || !raw.trim()) return;
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    const expected = `${AGENTFLOW_SUPABASE_PROJECT_REF.toLowerCase()}.supabase.co`;
    if (host !== expected) {
      console.error(
        `[AgentFlow] VITE_SUPABASE_URL host is "${host}" but this build expects "${expected}". ` +
          `Auth and Edge Functions use different hosts → 401 on functions like twilio-reputation-check. ` +
          `Fix Vercel Environment Variables: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the same Supabase project dashboard.`,
      );
    }
  } catch {
    console.error("[AgentFlow] VITE_SUPABASE_URL is not a valid URL.");
  }
}
