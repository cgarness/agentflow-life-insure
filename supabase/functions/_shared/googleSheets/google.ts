// Google Drive / Sheets reads for the import. One consistent values.get per sync covers the header and
// every data row up to the cap (+1 to detect overflow), so prefix checks and new candidates come from
// the same snapshot. Tabs are addressed by numeric sheetId, resolved to the current title each read.
import { LIMITS } from "./config.ts";
import { classifyGoogleError, GoogleApiError } from "./errors.ts";

type FetchFn = typeof fetch;
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

async function getJson(fetchFn: FetchFn, url: string, token: string): Promise<any> {
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new GoogleApiError(0, "network", "transient", `network: ${e instanceof Error ? e.message : e}`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const c = classifyGoogleError(res.status, body);
    throw new GoogleApiError(res.status, c.reason, c.failure, `google ${res.status} ${c.reason}`);
  }
  return body;
}

export interface TabInfo { sheetId: number; title: string; rowCount: number; columnCount: number; index: number }
/** `locale` is the spreadsheet's own locale (e.g. "en_US"): it decides how its formatted dates read. */
export interface SpreadsheetInfo { spreadsheetId: string; name: string; locale: string | null; tabs: TabInfo[] }

/** Verifies server-side access to a picked file (drive.file grant) and lists its tabs. */
export async function inspectSpreadsheet(fetchFn: FetchFn, token: string, spreadsheetId: string): Promise<SpreadsheetInfo> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId)) throw new GoogleApiError(400, "bad_id", "other", "invalid spreadsheet id");
  const file = await getJson(fetchFn,
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`, token);
  if (file?.mimeType !== SHEET_MIME) throw new GoogleApiError(400, "not_a_spreadsheet", "other", "not a Google Sheets file");
  if (file?.trashed) throw new GoogleApiError(404, "trashed", "access_lost", "spreadsheet is in the trash");
  const meta = await getJson(fetchFn,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties(title,locale),sheets.properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount))`,
    token);
  const tabs: TabInfo[] = (meta?.sheets ?? [])
    .map((s: any) => s?.properties)
    .filter((p: any) => p && (p.sheetType ?? "GRID") === "GRID")
    .map((p: any) => ({
      sheetId: Number(p.sheetId), title: String(p.title ?? ""), index: Number(p.index ?? 0),
      rowCount: Number(p.gridProperties?.rowCount ?? 0), columnCount: Number(p.gridProperties?.columnCount ?? 0),
    }));
  const locale = typeof meta?.properties?.locale === "string" && meta.properties.locale ? meta.properties.locale : null;
  return { spreadsheetId, name: String(meta?.properties?.title ?? file?.name ?? ""), locale, tabs };
}

export function columnLetter(n: number): string {
  let s = "";
  let x = Math.max(1, n);
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

export interface TabRead {
  spreadsheetName: string;
  title: string;
  header: string[];
  /** Data rows; rows[i] is sheet row number i + 2. Cells are trimmed strings. Trailing empty rows removed. */
  rows: string[][];
  overflow: boolean;
  /** The spreadsheet locale (typed v2 dates); null when Google did not report one. */
  locale: string | null;
  /** The tab's grid width; columns past LIMITS.maxColumns are not read here (see readBeyondLimit). */
  columnCount: number;
}

/** Reads a tab (by numeric sheetId) in ONE values request. Missing tab → access/review handled by caller. */
export async function readTab(fetchFn: FetchFn, token: string, spreadsheetId: string, sheetId: number): Promise<TabRead> {
  const info = await inspectSpreadsheet(fetchFn, token, spreadsheetId);
  const tab = info.tabs.find((t) => t.sheetId === sheetId);
  if (!tab) throw new GoogleApiError(404, "tab_missing", "other", "tab no longer exists");
  const cols = Math.min(Math.max(tab.columnCount, 1), LIMITS.maxColumns);
  const lastRow = LIMITS.maxDataRows + 2; // header + cap + one extra row to detect overflow
  const range = `'${tab.title.replace(/'/g, "''")}'!A1:${columnLetter(cols)}${lastRow}`;
  const body = await getJson(fetchFn,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}` +
      `?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, token);
  const values: unknown[][] = Array.isArray(body?.values) ? body.values : [];
  const norm = (r: unknown[] | undefined) => (r ?? []).map((c) => (c === null || c === undefined ? "" : String(c).trim()));
  const header = norm(values[0]);
  const rows = values.slice(1).map((r) => norm(r));
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  const overflow = rows.length > LIMITS.maxDataRows;
  return { spreadsheetName: info.name, title: tab.title, header, rows: overflow ? rows.slice(0, LIMITS.maxDataRows) : rows, overflow,
           locale: info.locale, columnCount: tab.columnCount };
}

/** Columns past LIMITS.maxColumns, as far as they were scanned. Header labels and presence flags only — never cell values. */
export interface BeyondLimit {
  /** The tab's actual grid width in columns. */
  width: number;
  /** The last column scanned (= width when the whole grid was scanned). */
  checked_through: number;
  /** Scanned columns past the limit that hold a header or any data, in sheet order. */
  columns: { letter: string; header: string; has_data: boolean }[];
  /** The grid is wider than the scan bound: whatever is past checked_through is unknown (and never imported). */
  unchecked: boolean;
}

/** Google could not be read completely within the bounds (timeout, size, unexpected shape). Never a passed check. */
export const INSPECTION_INCOMPLETE = "inspection_incomplete";

/** One bounded GET: a timeout covering headers and body (its timer is always cleared), and a byte cap enforced while streaming. */
async function getJsonBounded(fetchFn: FetchFn, url: string, token: string, timeoutMs: number, maxBytes: number): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const incomplete = (why: string) => new GoogleApiError(0, INSPECTION_INCOMPLETE, "transient", `inspection incomplete: ${why}`);
  try {
    let res: Response;
    try {
      res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
    } catch (e) {
      if (ctl.signal.aborted) throw incomplete("timeout");
      throw new GoogleApiError(0, "network", "transient", `network: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const c = classifyGoogleError(res.status, body);
      throw new GoogleApiError(res.status, c.reason, c.failure, `google ${res.status} ${c.reason}`);
    }
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) { await res.body?.cancel(); throw incomplete("size"); }
    const reader = res.body?.getReader();
    if (!reader) throw incomplete("no body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw incomplete("size"); }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof GoogleApiError) throw e;
      throw incomplete(ctl.signal.aborted ? "timeout" : "body");
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw incomplete("json"); }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Columns past the import limit (A–GR). Mapping checks only: one row-and-data read of at most
 * LIMITS.beyondLimitScanColumns columns × the import row bound, column-major, so a column with a blank header but data
 * further down is found too. Nothing is read when the grid is within the limit. Only header labels and whether a
 * column has data are kept; cell values are discarded immediately and never returned or logged.
 */
export async function readBeyondLimit(fetchFn: FetchFn, token: string, spreadsheetId: string, title: string,
  width: number, bounds: { timeoutMs: number; maxBytes: number } = { timeoutMs: LIMITS.beyondLimitTimeoutMs, maxBytes: LIMITS.beyondLimitMaxBytes },
): Promise<BeyondLimit> {
  if (width <= LIMITS.maxColumns) return { width, checked_through: width, columns: [], unchecked: false };
  const last = Math.min(width, LIMITS.maxColumns + LIMITS.beyondLimitScanColumns);
  const range = `'${title.replace(/'/g, "''")}'!${columnLetter(LIMITS.maxColumns + 1)}1:${columnLetter(last)}${LIMITS.maxDataRows + 2}`;
  const body = await getJsonBounded(fetchFn,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}` +
      `?majorDimension=COLUMNS&valueRenderOption=FORMATTED_VALUE`, token, bounds.timeoutMs, bounds.maxBytes);
  // Google omits `values` for an empty range; anything else that is not a column array is an incomplete read.
  if (body === null || typeof body !== "object" || (body.values !== undefined && !Array.isArray(body.values))
      || (body.values !== undefined && body.majorDimension !== "COLUMNS") || (Array.isArray(body.values) && body.values.length > last - LIMITS.maxColumns)) {
    throw new GoogleApiError(0, INSPECTION_INCOMPLETE, "transient", "inspection incomplete: shape");
  }
  const cell = (c: unknown) => (c === null || c === undefined ? "" : String(c).trim());
  const columns: BeyondLimit["columns"] = [];
  (Array.isArray(body.values) ? body.values : []).forEach((col: unknown, i: number) => {
    const cells = Array.isArray(col) ? col : [];
    const header = cell(cells[0]);
    const hasData = cells.slice(1).some((c: unknown) => cell(c) !== "");
    if (header || hasData) columns.push({ letter: columnLetter(LIMITS.maxColumns + 1 + i), header, has_data: hasData });
  });
  return { width, checked_through: last, columns, unchecked: width > last };
}
