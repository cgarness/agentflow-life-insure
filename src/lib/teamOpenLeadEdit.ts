/**
 * teamOpenLeadEdit — pure draft / validation / save-plan logic for the Team / Open Pool inline edit.
 *
 * Save routing (implementation_plan.md §5, D-4, D-6):
 *   - Standard fields → `leadsSupabaseApi.update` through its approved camelCase mapping, CHANGED
 *     keys only (an untouched field is never rewritten — the legacy path erased `lead_source`).
 *     Source and Assigned Agent are read-only and can never enter a plan.
 *   - Custom fields → the nested `custom_fields[<canonical name>]` key, merged onto a FRESHLY read
 *     bag (`mergeCustomFieldsBag`) so unrelated, reserved and internal keys survive untouched and
 *     the bag is never replaced by only the visible fields.
 *   - The campaign snapshot is rewritten only for changed name / phone / email / state.
 */
import { z } from "zod";
import type { Lead } from "@/lib/types";
import {
  SNAPSHOT_SYNCED_STANDARD_IDS,
  isHiddenLeadCustomKey,
  type ResolvedLeadField,
  type TeamOpenStandardId,
} from "@/lib/dialerLeadFields";
import { STATE_ABBR_TO_NAME } from "@/utils/stateUtils";
import { normalizePhoneNumber } from "@/utils/phoneUtils";

export type TeamOpenDraft = Record<string, string>;

export function seedTeamOpenDraft(fields: readonly ResolvedLeadField[]): TeamOpenDraft {
  const draft: TeamOpenDraft = {};
  for (const f of fields) if (f.editable) draft[f.id] = f.editValue;
  return draft;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealIsoDate = (s: string) => {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const EMAIL = z.string().email();

/** Per-field Zod schema. Every schema trims and accepts "" (clearing a value). */
function fieldSchema(f: ResolvedLeadField): z.ZodType<string, z.ZodTypeDef, string> {
  const base = z.string().trim();
  const blankOr = (ok: (s: string) => boolean, message: string) =>
    base.refine((s) => s === "" || ok(s), message);
  switch (f.input) {
    case "email":
      return blankOr((s) => EMAIL.safeParse(s).success, "Enter a valid email address");
    case "phone": {
      const validDigits = (s: string) => {
        const n = s.replace(/\D/g, "").length;
        return n >= 10 && n <= 15;
      };
      // The standard phone is the dial target: it may not be blanked once it holds a number.
      if (f.standardId === "phone" && f.editValue.trim() !== "") {
        return base.refine((s) => s !== "" && validDigits(s), "Enter a valid phone number");
      }
      return blankOr(validDigits, "Enter a valid phone number");
    }
    case "number":
      return f.standardId === "age"
        ? blankOr((s) => /^\d{1,3}$/.test(s) && Number(s) <= 130, "Age must be a whole number up to 130")
        : blankOr((s) => Number.isFinite(Number(s)), "Enter a number");
    case "date":
      return blankOr(isRealIsoDate, "Use a valid date");
    case "state":
      return blankOr((s) => s.toUpperCase() in STATE_ABBR_TO_NAME || s === f.editValue, "Choose a state");
    case "select": {
      const allowed = new Set([...(f.options ?? []), f.editValue]);
      return blankOr((s) => allowed.has(s), "Choose one of the listed options");
    }
    default:
      return base;
  }
}

export type SnapshotColumn = "first_name" | "last_name" | "phone" | "email" | "state";

export interface TeamOpenSavePlan {
  /** Partial<Lead> for `leadsSupabaseApi.update` — standard changes only (customFields added later). */
  standard: Partial<Lead>;
  /** Changed snapshot-synced standard fields (their saved values are taken from the returned row). */
  snapshotColumns: SnapshotColumn[];
  customSet: Record<string, string | number>;
  customUnset: string[];
  changedIds: string[];
}

export type SavePlanResult =
  | { ok: true; plan: TeamOpenSavePlan }
  | { ok: false; errors: Record<string, string> };

const SNAPSHOT_COLUMN: Partial<Record<TeamOpenStandardId, SnapshotColumn>> = {
  firstName: "first_name",
  lastName: "last_name",
  phone: "phone",
  email: "email",
  state: "state",
};

/** Validates the draft (Zod) and builds the minimal save plan from CHANGED editable fields. */
export function buildTeamOpenSavePlan(
  fields: readonly ResolvedLeadField[],
  initial: TeamOpenDraft,
  draft: TeamOpenDraft,
): SavePlanResult {
  const errors: Record<string, string> = {};
  const plan: TeamOpenSavePlan = { standard: {}, snapshotColumns: [], customSet: {}, customUnset: [], changedIds: [] };
  const std = plan.standard as Record<string, unknown>;

  for (const f of fields) {
    if (!f.editable || !(f.id in draft)) continue;
    const raw = draft[f.id] ?? "";
    if (raw === (initial[f.id] ?? "")) continue;
    const parsed = fieldSchema(f).safeParse(raw);
    if (!parsed.success) {
      errors[f.id] = parsed.error.issues[0]?.message ?? "Invalid value";
      continue;
    }
    const v = parsed.data;
    if (v === (initial[f.id] ?? "").trim()) continue; // whitespace-only change
    plan.changedIds.push(f.id);

    if (f.kind === "custom" && f.customName && !isHiddenLeadCustomKey(f.customName)) {
      if (v === "") plan.customUnset.push(f.customName);
      else plan.customSet[f.customName] = f.input === "number" ? Number(v) : v;
      continue;
    }
    switch (f.standardId) {
      case "firstName": std.firstName = v; break;
      case "lastName": std.lastName = v; break;
      case "phone": std.phone = normalizePhoneNumber(v); break; // same normalization as the contact view
      case "email": std.email = v; break;
      case "state": std.state = v.toUpperCase() in STATE_ABBR_TO_NAME ? v.toUpperCase() : v; break;
      case "age": std.age = v === "" ? null : Number(v); break;
      case "dateOfBirth": std.dateOfBirth = v === "" ? null : v; break;
      case "bestTimeToCall": std.bestTimeToCall = v === "" ? null : v; break;
      case "spouseInfo": std.spouseInfo = v === "" ? null : v; break;
      case "notes": std.notes = v === "" ? null : v; break;
      default: continue; // leadSource / assignedAgentId are never editable here
    }
    const col = f.standardId ? SNAPSHOT_COLUMN[f.standardId] : undefined;
    if (col && SNAPSHOT_SYNCED_STANDARD_IDS.includes(f.standardId!)) plan.snapshotColumns.push(col);
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, plan };
}

export const planHasChanges = (p: TeamOpenSavePlan) => p.changedIds.length > 0;
export const planTouchesCustom = (p: TeamOpenSavePlan) =>
  Object.keys(p.customSet).length > 0 || p.customUnset.length > 0;

/**
 * Applies ONLY the changed custom keys onto the freshly read stored bag. Every other key —
 * unrelated agency values, `additional_policies`, `__agentflow`, `tags` — is carried by reference,
 * never normalized or rebuilt. A stored bag that is not a plain object is refused (never overwritten).
 */
export function mergeCustomFieldsBag(
  stored: unknown,
  set: Record<string, string | number>,
  unset: readonly string[],
): { ok: true; bag: Record<string, unknown> } | { ok: false; reason: string } {
  if (stored !== null && stored !== undefined && (typeof stored !== "object" || Array.isArray(stored))) {
    return { ok: false, reason: "The stored custom fields are not in the expected format; nothing was saved." };
  }
  const bag: Record<string, unknown> = { ...((stored as Record<string, unknown> | null) ?? {}) };
  for (const [k, v] of Object.entries(set)) {
    if (isHiddenLeadCustomKey(k)) return { ok: false, reason: `Refusing to write reserved key "${k}".` };
    bag[k] = v;
  }
  for (const k of unset) {
    if (isHiddenLeadCustomKey(k)) return { ok: false, reason: `Refusing to remove reserved key "${k}".` };
    delete bag[k];
  }
  return { ok: true, bag };
}

/** Maps the canonical update's returned `Lead` back to the master-row shape the card reads. */
export function leadToMasterRow(lead: Lead): Record<string, unknown> {
  return {
    id: lead.id,
    first_name: lead.firstName,
    last_name: lead.lastName,
    phone: lead.phone,
    email: lead.email,
    state: lead.state,
    status: lead.status,
    lead_source: lead.leadSource,
    age: lead.age ?? null,
    date_of_birth: lead.dateOfBirth ?? null,
    best_time_to_call: lead.bestTimeToCall ?? null,
    spouse_info: lead.spouseInfo ?? null,
    notes: lead.notes ?? null,
    assigned_agent_id: lead.assignedAgentId ?? null,
    user_id: lead.userId ?? null,
    custom_fields: lead.customFields ?? null,
    updated_at: lead.updatedAt,
  };
}
