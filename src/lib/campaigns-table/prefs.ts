import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { normalizeColumnLayout, type ColumnLayout } from "./columns";

/**
 * Campaigns table column preferences, stored in the caller's own `user_preferences` row
 * (UNIQUE(user_id); RLS auth.uid() = user_id) under one org-namespaced key:
 *
 *   settings.campaigns_table = { v: 1, orgs: { [organizationId]: { order, hidden } } }
 *
 * Rules: reads never write; a write re-reads the row, changes ONLY `orgs[orgId]`, and
 * compare-and-sets on the trigger-maintained `updated_at` (live trigger `set_updated_at`).
 * A zero-row update is a conflict, never a success. Other settings keys, other
 * organizations' entries and other users' rows are never touched.
 */

export const CAMPAIGNS_TABLE_PREFS_KEY = "campaigns_table";

const OrgLayoutSchema = z.object({
  order: z.array(z.string()).max(64),
  hidden: z.array(z.string()).max(64),
});
const PrefsSchema = z.object({
  v: z.literal(1),
  orgs: z.record(z.string(), z.unknown()),
});

export class CampaignsPrefsError extends Error {
  readonly kind: "read" | "write" | "conflict" | "unsupported";
  /** The raw provider error, for console diagnostics only — never rendered. */
  readonly cause: unknown;
  constructor(kind: CampaignsPrefsError["kind"], cause?: unknown) {
    super(
      kind === "read" ? "Couldn't load saved columns."
        : kind === "conflict" ? "Your columns changed elsewhere. Try again."
          : kind === "unsupported" ? "Saved columns use a newer format and can't be changed here."
            : "Couldn't save columns. Try again.",
    );
    this.name = "CampaignsPrefsError";
    this.kind = kind;
    this.cause = cause;
  }
}

export class CampaignsPrefsSupersededError extends Error {
  constructor() {
    super("Superseded");
    this.name = "CampaignsPrefsSupersededError";
  }
}

export interface PrefsRow {
  exists: boolean;
  settings: Record<string, unknown>;
  /** Exact string as returned by PostgREST — compared verbatim, never round-tripped through Date. */
  updatedAt: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readPrefsRow(userId: string, signal?: AbortSignal): Promise<PrefsRow> {
  let q = supabase.from("user_preferences").select("settings, updated_at").eq("user_id", userId);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q.maybeSingle();
  if (error) throw new CampaignsPrefsError("read", error);
  if (!data) return { exists: false, settings: {}, updatedAt: null };
  if (!isPlainObject(data.settings)) throw new CampaignsPrefsError("unsupported");
  return { exists: true, settings: data.settings, updatedAt: data.updated_at ?? null };
}

/** The viewer's layout for one organization; anything malformed yields the defaults. */
export function layoutFromSettings(settings: Record<string, unknown>, orgId: string): ColumnLayout {
  const parsed = PrefsSchema.safeParse(settings[CAMPAIGNS_TABLE_PREFS_KEY]);
  if (!parsed.success) return normalizeColumnLayout(null);
  const entry = OrgLayoutSchema.safeParse(parsed.data.orgs[orgId]);
  return normalizeColumnLayout(entry.success ? entry.data : null);
}

/** Returns a new settings object with only `campaigns_table.orgs[orgId]` changed (null removes it). */
export function mergeLayoutIntoSettings(
  settings: Record<string, unknown>,
  orgId: string,
  layout: ColumnLayout | null,
): Record<string, unknown> {
  const existing = settings[CAMPAIGNS_TABLE_PREFS_KEY];
  let orgs: Record<string, unknown> = {};
  if (existing !== undefined) {
    if (isPlainObject(existing) && existing.v !== undefined && existing.v !== 1) {
      throw new CampaignsPrefsError("unsupported");
    }
    const parsed = PrefsSchema.safeParse(existing);
    if (parsed.success) orgs = { ...parsed.data.orgs };
  }
  if (layout) orgs[orgId] = { order: [...layout.order], hidden: [...layout.hidden] };
  else delete orgs[orgId];
  return { ...settings, [CAMPAIGNS_TABLE_PREFS_KEY]: { v: 1, orgs } };
}

const MAX_WRITE_ATTEMPTS = 2;

/**
 * Save (or, with `layout = null`, reset) this organization's entry. `isCurrent` is re-checked
 * after every await before any write is sent, so a superseded owner never writes.
 */
export async function writeColumnLayout(params: {
  userId: string;
  orgId: string;
  layout: ColumnLayout | null;
  isCurrent: () => boolean;
}): Promise<ColumnLayout> {
  const { userId, orgId, layout, isCurrent } = params;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const row = await readPrefsRow(userId);
    if (!isCurrent()) throw new CampaignsPrefsSupersededError();
    const next = mergeLayoutIntoSettings(row.settings, orgId, layout) as Json;
    if (!row.exists) {
      const { error } = await supabase.from("user_preferences").insert({ user_id: userId, settings: next });
      if (!error) return layoutFromSettings(next as Record<string, unknown>, orgId);
      if ((error as { code?: string }).code === "23505") continue; // created concurrently: re-read, merge, CAS
      throw new CampaignsPrefsError("write", error);
    }
    let q = supabase.from("user_preferences").update({ settings: next }).eq("user_id", userId);
    q = row.updatedAt === null ? q.is("updated_at", null) : q.eq("updated_at", row.updatedAt);
    const { data, error } = await q.select("updated_at");
    if (error) throw new CampaignsPrefsError("write", error);
    if (Array.isArray(data) && data.length > 0) return layoutFromSettings(next as Record<string, unknown>, orgId);
    // Zero rows: another writer changed the row since our read. Re-read and try again.
  }
  throw new CampaignsPrefsError("conflict");
}
