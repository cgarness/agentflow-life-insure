/**
 * dialerLeadFields — typed field resolution for the Team / Open Pool dialer lead card.
 *
 * Scope: Team and Open Pool ONLY. The Personal card keeps `LeadCard`'s legacy descriptor path;
 * nothing here changes `contactFieldLayout.ts` or any global layout semantics.
 *
 * Rules (implementation_plan.md §5):
 *   - The saved layout (user → agency → default, `resolveFieldOrder`) is ORDERING, not inventory.
 *     Supported fields it does not list are appended deterministically: remaining standard fields in
 *     registry order, then remaining custom definitions (name, then id), then saved custom values
 *     that have no visible definition (key order). A populated imported value is never dropped just
 *     because an older layout lacks its descriptor.
 *   - Standard and custom identities never collide: `std:<id>` vs `custom:<name>` — used for React
 *     keys, draft keys and save routing alike. A colliding custom label gets a UI-only "(custom)".
 *   - Standard values come from their approved mapping. Fields the header and dial path read from
 *     the campaign snapshot prefer the snapshot (so the card never contradicts the number being
 *     dialled) and fall back to the master row; Source reads `leads.lead_source` first.
 *   - Custom values come ONLY from the master row's `custom_fields[<canonical name>]`
 *     (AGENT_RULES #27). Internal keys never surface: reserved keys (`isReservedCustomFieldKey`,
 *     i.e. `additional_policies`, #35), the importer's `__agentflow` marker family and `tags`.
 *   - No arbitrary top-level column is ever enumerated: only the registry below and custom keys.
 */
import type { CustomField } from "@/lib/types";
import { isReservedCustomFieldKey } from "@/lib/reservedCustomFields";
import { formatDOB } from "@/utils/dobUtils";
import { normalizeFieldName } from "@/lib/import-field-matching";

export type TeamOpenStandardId =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "state"
  | "leadSource"
  | "age"
  | "dateOfBirth"
  | "bestTimeToCall"
  | "spouseInfo"
  | "assignedAgentId"
  | "notes";

export type TeamOpenInput = "text" | "email" | "phone" | "number" | "date" | "select" | "textarea" | "state";

export interface TeamOpenStandardSpec {
  id: TeamOpenStandardId;
  label: string;
  /** Column on `public.leads` (the master contact). */
  masterKey: string;
  /** Column on `public.campaign_leads` that the header / dial path reads, when one exists. */
  snapshotKey?: string;
  /** null = never editable here (D-4 Source; no new assignment control). */
  input: TeamOpenInput | null;
  /** Display hint. */
  format?: "date" | "agent";
}

/** Registry order is the deterministic append order. Labels match `contactFieldLayout`'s registry. */
export const TEAM_OPEN_STANDARD_FIELDS: readonly TeamOpenStandardSpec[] = [
  { id: "firstName", label: "First Name", masterKey: "first_name", snapshotKey: "first_name", input: "text" },
  { id: "lastName", label: "Last Name", masterKey: "last_name", snapshotKey: "last_name", input: "text" },
  { id: "phone", label: "Phone", masterKey: "phone", snapshotKey: "phone", input: "phone" },
  { id: "email", label: "Email", masterKey: "email", snapshotKey: "email", input: "email" },
  { id: "state", label: "State", masterKey: "state", snapshotKey: "state", input: "state" },
  { id: "leadSource", label: "Source", masterKey: "lead_source", snapshotKey: "source", input: null },
  { id: "age", label: "Age", masterKey: "age", snapshotKey: "age", input: "number" },
  { id: "dateOfBirth", label: "DOB", masterKey: "date_of_birth", input: "date", format: "date" },
  { id: "bestTimeToCall", label: "Best Time", masterKey: "best_time_to_call", input: "text" },
  { id: "spouseInfo", label: "Spouse", masterKey: "spouse_info", input: "text" },
  { id: "assignedAgentId", label: "Assigned Agent", masterKey: "assigned_agent_id", input: null, format: "agent" },
  { id: "notes", label: "Notes", masterKey: "notes", input: "textarea" },
];

/** Standard fields that also live on the campaign snapshot and are rewritten there on save. */
export const SNAPSHOT_SYNCED_STANDARD_IDS: readonly TeamOpenStandardId[] = [
  "firstName",
  "lastName",
  "phone",
  "email",
  "state",
];

const STANDARD_BY_ID = new Map(TEAM_OPEN_STANDARD_FIELDS.map((s) => [s.id, s]));

export type AgentLite = { id: string; firstName: string; lastName: string };

export interface ResolvedLeadField {
  /** `std:<id>` or `custom:<canonical name>` — unique across both kinds. */
  id: string;
  kind: "standard" | "custom";
  label: string;
  standardId?: TeamOpenStandardId;
  customName?: string;
  customType?: CustomField["type"];
  /** Raw stored value (never rendered directly). */
  value: unknown;
  /** Formatted display string; null = absent / blank / not renderable (hidden in view mode). */
  display: string | null;
  /** Field-level support for editing (the caller still applies permission / reveal gates). */
  editable: boolean;
  input: TeamOpenInput | null;
  options?: string[];
  /** String seed for an editor ("" when blank). */
  editValue: string;
}

export interface LeadDetailSources {
  /** The dialer queue row (campaign snapshot merged over whatever master data the loader had). */
  snapshot: Record<string, unknown> | null;
  /** The master `leads` row this viewer is authorized to read; null when unavailable. */
  master: Record<string, unknown> | null;
}

/** Custom-field bag keys that are AgentFlow-owned / internal and never shown or edited. */
export function isHiddenLeadCustomKey(key: string): boolean {
  return isReservedCustomFieldKey(key) || key.startsWith("__") || key === "tags" || key.trim() === "";
}

const isBlankString = (v: unknown) => typeof v === "string" && v.trim() === "";
const isAbsent = (v: unknown) => v === null || v === undefined || isBlankString(v);

function formatPrimitive(v: unknown, hint?: "date"): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    if (hint === "date") return formatDOB(t) || t;
    return t;
  }
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return null;
}

/**
 * Display formatting. Keeps valid `0` / `false`; hides null, undefined, empty and whitespace-only;
 * joins arrays of primitives; NEVER renders an object (no "[object Object]").
 */
export function formatLeadFieldValue(value: unknown, hint?: "date"): string | null {
  if (Array.isArray(value)) {
    if (value.some((x) => x !== null && typeof x === "object")) return null;
    const parts = value.map((x) => formatPrimitive(x, hint)).filter((x): x is string => x !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return formatPrimitive(value, hint);
}

const isEditableScalar = (v: unknown) =>
  v === null || v === undefined || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

const toEditValue = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";

function resolveStandard(spec: TeamOpenStandardSpec, src: LeadDetailSources, agents?: AgentLite[]) {
  const snap = spec.snapshotKey ? src.snapshot?.[spec.snapshotKey] : undefined;
  const mast = src.master ? src.master[spec.masterKey] : undefined;
  // Source and Age: the canonical master column first (neither is read by the header or the dial
  // path, and Age is not re-synced to the snapshot). Name / phone / email / state: snapshot first,
  // so the card agrees with the header and the dialled number.
  const masterFirst = spec.id === "leadSource" || spec.id === "age";
  const value = masterFirst ? (isAbsent(mast) ? snap : mast) : isAbsent(snap) ? mast : snap;

  let display: string | null;
  if (spec.format === "agent") {
    const agent = typeof value === "string" ? agents?.find((a) => a.id === value) : undefined;
    display = agent ? `${agent.firstName} ${agent.lastName}`.trim() || null : null; // never a raw id
  } else {
    display = formatLeadFieldValue(value, spec.format === "date" ? "date" : undefined);
  }
  const editable = spec.input !== null && isEditableScalar(value);
  return { value, display, editable, editValue: editable ? toEditValue(value) : "" };
}

/** Deterministic representative among definitions sharing one exact name (#33 ordering). */
function pickRepresentative(rows: CustomField[]): CustomField {
  const agency = (f: CustomField) => (f.scope === "agency" || f.createdBy === null ? 0 : 1);
  const at = (f: CustomField) => {
    const t = f.createdAt ? Date.parse(f.createdAt) : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return [...rows].sort(
    (a, b) => agency(a) - agency(b) || at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}

function customInput(type: CustomField["type"]): TeamOpenInput | null {
  switch (type) {
    case "Text": return "text";
    case "Email": return "email";
    case "Phone": return "phone";
    case "Number": return "number";
    case "Date": return "date";
    case "Dropdown": return "select";
    default: return null;
  }
}

export interface ResolveArgs {
  layoutIds: readonly string[];
  sources: LeadDetailSources;
  /** Visible definitions; null = unavailable (loading or failed) — never treated as "none". */
  definitions: readonly CustomField[] | null;
  agents?: AgentLite[];
}

/** Every supported field for this lead, in display order, including blank ones (for edit mode). */
export function resolveTeamOpenLeadFields({ layoutIds, sources, definitions, agents }: ResolveArgs): ResolvedLeadField[] {
  const bagRaw = sources.master?.custom_fields;
  const bag: Record<string, unknown> =
    bagRaw && typeof bagRaw === "object" && !Array.isArray(bagRaw) ? (bagRaw as Record<string, unknown>) : {};

  // One LOGICAL definition per normalized name (AGENT_RULES #33), keyed by the bag key that
  // actually holds the value (else the deterministic representative's canonical name).
  const defsByName = new Map<string, CustomField>();
  const logicalKeyByNorm = new Map<string, string>();
  if (definitions) {
    const groups = new Map<string, CustomField[]>();
    for (const d of definitions) {
      if (!d || typeof d.name !== "string" || isHiddenLeadCustomKey(d.name)) continue;
      if (d.active === false || !Array.isArray(d.appliesTo) || !d.appliesTo.includes("Leads")) continue;
      const norm = normalizeFieldName(d.name);
      groups.set(norm, [...(groups.get(norm) ?? []), d]);
    }
    for (const rows of groups.values()) {
      const rep = pickRepresentative(rows);
      const names = [rep.name, ...rows.map((r) => r.name).filter((n) => n !== rep.name)];
      const key = names.find((n) => Object.prototype.hasOwnProperty.call(bag, n)) ?? rep.name;
      defsByName.set(key, rep);
      logicalKeyByNorm.set(normalizeFieldName(rep.name), key);
    }
  }
  // A layout id naming another spelling of a logical field resolves to that field's key.
  const toLogicalKey = (name: string) =>
    defsByName.has(name) ? name : logicalKeyByNorm.get(normalizeFieldName(name)) ?? name;

  const collides = (name: string) => {
    const n = name.trim().toLowerCase();
    return TEAM_OPEN_STANDARD_FIELDS.some(
      (s) => [s.id, s.label, s.masterKey, s.snapshotKey ?? ""].some((x) => x.toLowerCase() === n),
    );
  };

  const buildCustom = (name: string): ResolvedLeadField | null => {
    if (isHiddenLeadCustomKey(name)) return null;
    const def = defsByName.get(name);
    const hasValue = Object.prototype.hasOwnProperty.call(bag, name);
    if (!def && !hasValue) return null; // nothing to show or edit
    const value = hasValue ? bag[name] : undefined;
    const input = def && sources.master ? customInput(def.type) : null;
    const editable = input !== null && isEditableScalar(value);
    const rawOptions: unknown = def?.dropdownOptions;
    const options =
      def?.type === "Dropdown"
        ? Array.isArray(rawOptions) ? rawOptions.filter((o): o is string => typeof o === "string") : []
        : undefined;
    return {
      id: `custom:${name}`,
      kind: "custom",
      label: collides(name) ? `${name} (custom)` : name,
      customName: name,
      customType: def?.type,
      value,
      display: formatLeadFieldValue(value, def?.type === "Date" ? "date" : undefined),
      editable,
      input,
      options,
      editValue: editable ? toEditValue(value) : "",
    };
  };

  const buildStandard = (spec: TeamOpenStandardSpec): ResolvedLeadField => {
    const r = resolveStandard(spec, sources, agents);
    // Master-only fields cannot be edited without the master row; nothing can be saved without it.
    const editable = r.editable && sources.master !== null;
    return {
      id: `std:${spec.id}`,
      kind: "standard",
      label: spec.label,
      standardId: spec.id,
      value: r.value,
      display: r.display,
      editable,
      input: spec.input,
      editValue: editable ? r.editValue : "",
    };
  };

  const out: ResolvedLeadField[] = [];
  const seen = new Set<string>();
  const push = (f: ResolvedLeadField | null) => {
    if (!f || seen.has(f.id)) return;
    seen.add(f.id);
    out.push(f);
  };

  for (const raw of layoutIds) {
    if (typeof raw !== "string" || !raw) continue;
    if (raw.startsWith("custom:")) {
      const name = raw.slice("custom:".length);
      if (name) push(buildCustom(toLogicalKey(name)));
      continue;
    }
    const spec = STANDARD_BY_ID.get(raw as TeamOpenStandardId);
    if (spec) push(buildStandard(spec)); // unknown / retired ids (leadScore, healthStatus) skipped
  }
  for (const spec of TEAM_OPEN_STANDARD_FIELDS) push(buildStandard(spec));
  const defKeys = [...defsByName.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const k of defKeys) push(buildCustom(k));
  for (const key of Object.keys(bag).sort()) push(buildCustom(key));
  return out;
}

/** View mode: populated fields only. */
export const visibleLeadFields = (fields: readonly ResolvedLeadField[]) => fields.filter((f) => f.display !== null);

/** Edit mode: every editable field (including empty agency fields) plus populated read-only ones. */
export const editModeLeadFields = (fields: readonly ResolvedLeadField[]) =>
  fields.filter((f) => f.editable || f.display !== null);
