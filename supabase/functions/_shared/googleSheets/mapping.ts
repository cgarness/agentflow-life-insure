// Mapping + validation for Sheets rows. Pure (no Deno/Supabase APIs) so the app test suite can pin its
// parity with the CSV importer: splitFullName (ImportLeadsModal), parseDOB (src/utils/dobUtils),
// normalizeFieldName / buildLogicalCustomFields (src/lib/import-field-matching), and the import-contacts
// core contract (first name, last name, phone digits). Ported because Deno cannot import from src/.

export const STANDARD_TARGETS = [
  "first_name", "last_name", "full_name", "phone", "email", "state", "lead_source",
  "age", "date_of_birth", "best_time_to_call", "notes",
] as const;
export type StandardTarget = (typeof STANDARD_TARGETS)[number];

/** Built-in names offered by the CSV mapper; a custom field normalising to one of these is ambiguous. */
export const BUILT_IN_FIELD_NAMES = [
  "First Name", "Last Name", "Full Name", "Phone", "Email", "State", "Lead Source",
  "Age", "Date of Birth", "Best Time to Call", "Notes", "Assigned Agent",
];
const RESERVED_CUSTOM_KEYS = new Set(["additional_policies", "__agentflow", "tags", "full name"]);

export interface MappingColumn { header: string; target: string } // StandardTarget | `custom:<uuid>`
export interface SheetMapping { v: 1; columns: MappingColumn[] }

export function normalizeFieldName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isCustomTarget(t: string): boolean {
  return /^custom:[0-9a-f-]{36}$/i.test(t);
}

/** Structural validation of a stored/submitted mapping (no sheet access). */
export function validateMapping(m: unknown): { ok: true; mapping: SheetMapping } | { ok: false; reason: string } {
  const mm = m as SheetMapping;
  if (!mm || mm.v !== 1 || !Array.isArray(mm.columns) || mm.columns.length > 200) return { ok: false, reason: "invalid_mapping" };
  const seenHeaders = new Set<string>();
  const seenTargets = new Set<string>();
  for (const c of mm.columns) {
    if (typeof c?.header !== "string" || !c.header.trim() || typeof c?.target !== "string") return { ok: false, reason: "invalid_mapping" };
    if (!(STANDARD_TARGETS as readonly string[]).includes(c.target) && !isCustomTarget(c.target)) return { ok: false, reason: "invalid_target" };
    const h = normalizeFieldName(c.header);
    if (seenHeaders.has(h)) return { ok: false, reason: "duplicate_header" };
    if (seenTargets.has(c.target)) return { ok: false, reason: "duplicate_target" };
    seenHeaders.add(h); seenTargets.add(c.target);
  }
  const t = new Set(mm.columns.map((c) => c.target));
  if (!t.has("phone")) return { ok: false, reason: "phone_required" };
  if (!(t.has("full_name") || (t.has("first_name") && t.has("last_name")))) return { ok: false, reason: "name_required" };
  return { ok: true, mapping: { v: 1, columns: mm.columns.map((c) => ({ header: c.header.trim(), target: c.target })) } };
}

export interface ResolvedColumns {
  std: Partial<Record<StandardTarget, number>>;
  custom: { idx: number; customFieldId: string }[];
  idIdx: number | null;
  problems: string[];
}

/** Resolves mapped headers by normalised NAME (columns may move). Missing/duplicated → problems. */
export function resolveColumns(header: string[], mapping: SheetMapping, idHeader: string | null): ResolvedColumns {
  const index = new Map<string, number[]>();
  header.forEach((h, i) => {
    if (!h) return;
    const k = normalizeFieldName(h);
    index.set(k, [...(index.get(k) ?? []), i]);
  });
  const out: ResolvedColumns = { std: {}, custom: [], idIdx: null, problems: [] };
  const find = (h: string): number | null => {
    const hits = index.get(normalizeFieldName(h)) ?? [];
    if (hits.length === 0) { out.problems.push(`missing:${h}`); return null; }
    if (hits.length > 1) { out.problems.push(`duplicate:${h}`); return null; }
    return hits[0];
  };
  for (const c of mapping.columns) {
    const i = find(c.header);
    if (i === null) continue;
    if (isCustomTarget(c.target)) out.custom.push({ idx: i, customFieldId: c.target.slice(7) });
    else out.std[c.target as StandardTarget] = i;
  }
  if (idHeader) out.idIdx = find(idHeader);
  return out;
}

export interface OwnerCustomField { id: string; name: string; created_by: string | null; created_at: string | null }

/** Logical custom-field resolution (agency-wide first, then oldest, then lowest id); built-in shadow → null. */
export function resolveCustomFieldNames(ids: string[], fields: OwnerCustomField[]): { names: Map<string, string>; unresolved: string[] } {
  const groups = new Map<string, OwnerCustomField[]>();
  for (const f of fields) {
    const k = normalizeFieldName(f.name);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const builtIns = new Set(BUILT_IN_FIELD_NAMES.map(normalizeFieldName));
  const rank = (a: OwnerCustomField, b: OwnerCustomField) => {
    const ag = (f: OwnerCustomField) => (f.created_by === null ? 0 : 1);
    if (ag(a) !== ag(b)) return ag(a) - ag(b);
    const t = (f: OwnerCustomField) => { const v = f.created_at ? Date.parse(f.created_at) : NaN; return Number.isFinite(v) ? v : Infinity; };
    if (t(a) !== t(b)) return t(a) - t(b);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
  const names = new Map<string, string>();
  const unresolved: string[] = [];
  for (const id of ids) {
    const f = fields.find((x) => x.id === id);
    const key = f ? normalizeFieldName(f.name) : null;
    if (!f || !key || builtIns.has(key) || RESERVED_CUSTOM_KEYS.has(key)) { unresolved.push(id); continue; }
    names.set(id, [...(groups.get(key) ?? [f])].sort(rank)[0].name);
  }
  return { names, unresolved };
}

/** CSV importer's Full Name split: first token / rest. A single word leaves last name blank. */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// ---- parseDOB port (src/utils/dobUtils.ts, parse path only) ----
const YEAR_MIN = 1900, YEAR_MAX = 2100;
const EXCEL_DAY_ZERO_MS = Date.UTC(1900, 0, 1);
const pad2 = (n: number) => String(n).padStart(2, "0");
function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  if (y < YEAR_MIN || y > YEAR_MAX) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const toIso = (y: number, m: number, d: number) => (isValidCalendarDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null);
function parseExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const whole = Math.floor(serial);
  const offset = whole < 60 ? whole - 1 : whole - 2;
  const date = new Date(EXCEL_DAY_ZERO_MS + offset * 86_400_000);
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function parseDelimitedDate(input: string): string | null {
  const parts = input.trim().replace(/\./g, "/").replace(/-/g, "/").split("/").map((p) => p.trim());
  if (parts.length !== 3) return null;
  const a = parseInt(parts[0], 10), b = parseInt(parts[1], 10), c = parseInt(parts[2], 10);
  if ([a, b, c].some((n) => Number.isNaN(n))) return null;
  if (parts[0].length === 4) return toIso(a, b, c);
  let year: number;
  if (parts[2].length === 2) year = c < 0 || c > 99 ? c : 1900 + c;
  else if (parts[2].length === 4) year = c;
  else return null;
  return toIso(year, a, b);
}
export function parseDOB(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const str = String(input).trim();
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) { const s = parseExcelSerial(parseFloat(str)); if (s) return s; }
  const iso = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return toIso(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10));
  if (/[/\-.]/.test(str)) return parseDelimitedDate(str);
  return null;
}

export interface LeadPayload {
  first_name: string; last_name: string; phone: string; email: string; state: string; lead_source: string;
  age?: string; date_of_birth?: string; best_time_to_call?: string; notes?: string; custom_fields?: Record<string, string>;
}
export interface BuiltLead { empty: boolean; valid: boolean; reason?: string; core: string[]; lead?: LeadPayload }

/** Builds one lead from a sheet row with the CSV import contract. */
export function buildLead(row: string[], cols: ResolvedColumns, customNames: Map<string, string>): BuiltLead {
  const get = (t: StandardTarget) => { const i = cols.std[t]; return i === undefined ? "" : (row[i] ?? "").trim(); };
  const empty = row.every((c) => !c || !c.trim());
  let first = get("first_name"), last = get("last_name");
  const full = get("full_name");
  if (!first && !last && full) { const s = splitFullName(full); first = s.firstName; last = s.lastName; }
  const phone = get("phone"), email = get("email");
  const core = [normalizeFieldName(first), normalizeFieldName(last), phone.replace(/\D/g, ""), email.toLowerCase().trim()];
  if (empty) return { empty: true, valid: false, reason: "empty", core };
  if (!phone.replace(/\D/g, "")) return { empty, valid: false, reason: "missing_phone", core };
  if (!first || !last) return { empty, valid: false, reason: "missing_name", core };
  const dobRaw = get("date_of_birth");
  const dob = dobRaw ? parseDOB(dobRaw) : null;
  if (dobRaw && !dob) return { empty, valid: false, reason: "invalid_dob", core };
  const custom: Record<string, string> = {};
  if (full) custom["Full Name"] = full;
  for (const c of cols.custom) {
    const name = customNames.get(c.customFieldId);
    const v = (row[c.idx] ?? "").trim();
    if (name && v && name !== "Full Name") custom[name] = v;
  }
  const ageNum = parseInt(get("age"), 10);
  const lead: LeadPayload = {
    first_name: first, last_name: last, phone, email, state: get("state"), lead_source: get("lead_source"),
    ...(ageNum ? { age: String(ageNum) } : {}),
    ...(dob ? { date_of_birth: dob } : {}),
    ...(get("best_time_to_call") ? { best_time_to_call: get("best_time_to_call") } : {}),
    ...(get("notes") ? { notes: get("notes") } : {}),
    ...(Object.keys(custom).length ? { custom_fields: custom } : {}),
  };
  return { empty, valid: true, core, lead };
}

async function sha256Json(v: unknown): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(v))));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over the core identity values only (edits to optional/unmapped columns do not change it). */
export function fingerprint(core: string[]): Promise<string> {
  return sha256Json(core);
}

/**
 * Content signature (Finding 3): SHA-256 over the trimmed raw cells of EVERY mapped column (standard fields in a
 * fixed order, custom fields by id) plus the Lead ID column — exactly the values that would be imported. Two rows
 * sharing a Lead ID are genuine repeats only when their signatures are equal; invalid rows keep their own values.
 */
export function rowSignature(row: string[], cols: ResolvedColumns): Promise<string> {
  const cell = (i: number | undefined | null) => (i === undefined || i === null ? null : (row[i] ?? "").trim());
  return sha256Json({
    std: STANDARD_TARGETS.map((t) => cell(cols.std[t])),
    custom: [...cols.custom].sort((a, b) => (a.customFieldId < b.customFieldId ? -1 : a.customFieldId > b.customFieldId ? 1 : 0))
      .map((c) => [c.customFieldId, cell(c.idx)]),
    id: cell(cols.idIdx),
  });
}

/** Display values for review lists (raw, trimmed; never used for identity). */
export function displayFields(row: string[], cols: ResolvedColumns): { first_name: string; last_name: string; phone: string; email: string } {
  const get = (t: StandardTarget) => { const i = cols.std[t]; return i === undefined ? "" : (row[i] ?? "").trim(); };
  let first = get("first_name"), last = get("last_name");
  if (!first && !last && get("full_name")) { const s = splitFullName(get("full_name")); first = s.firstName; last = s.lastName; }
  return { first_name: first, last_name: last, phone: get("phone"), email: get("email") };
}
