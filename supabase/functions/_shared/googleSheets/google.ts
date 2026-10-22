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
export interface SpreadsheetInfo { spreadsheetId: string; name: string; tabs: TabInfo[] }

/** Verifies server-side access to a picked file (drive.file grant) and lists its tabs. */
export async function inspectSpreadsheet(fetchFn: FetchFn, token: string, spreadsheetId: string): Promise<SpreadsheetInfo> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId)) throw new GoogleApiError(400, "bad_id", "other", "invalid spreadsheet id");
  const file = await getJson(fetchFn,
    `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`, token);
  if (file?.mimeType !== SHEET_MIME) throw new GoogleApiError(400, "not_a_spreadsheet", "other", "not a Google Sheets file");
  if (file?.trashed) throw new GoogleApiError(404, "trashed", "access_lost", "spreadsheet is in the trash");
  const meta = await getJson(fetchFn,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title,index,sheetType,gridProperties(rowCount,columnCount))`,
    token);
  const tabs: TabInfo[] = (meta?.sheets ?? [])
    .map((s: any) => s?.properties)
    .filter((p: any) => p && (p.sheetType ?? "GRID") === "GRID")
    .map((p: any) => ({
      sheetId: Number(p.sheetId), title: String(p.title ?? ""), index: Number(p.index ?? 0),
      rowCount: Number(p.gridProperties?.rowCount ?? 0), columnCount: Number(p.gridProperties?.columnCount ?? 0),
    }));
  return { spreadsheetId, name: String(meta?.properties?.title ?? file?.name ?? ""), tabs };
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
  return { spreadsheetName: info.name, title: tab.title, header, rows: overflow ? rows.slice(0, LIMITS.maxDataRows) : rows, overflow };
}
