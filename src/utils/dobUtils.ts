import { format, isValid, parse } from "date-fns";

const ISO_STORAGE = "yyyy-MM-dd";
const DISPLAY_FULL = "MM/dd/yyyy";
const DISPLAY_BIRTHDAY_SHORT = "MMM d";

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/** Excel 1900 date system: serial 1 = 1900-01-01 (UTC), with Feb-29-1900 leap bug. */
const EXCEL_DAY_ZERO_MS = Date.UTC(1900, 0, 1);

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  if (year < YEAR_MIN || year > YEAR_MAX) return false;
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

function toIsoString(year: number, month: number, day: number): string | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseIsoOrder(y: number, m: number, d: number): string | null {
  return toIsoString(y, m, d);
}

function expandTwoDigitYear(yy: number): number {
  // Two-digit years always resolve to 19YY. AgentFlow is a US life insurance product;
  // buyers are 30–75 years old. A 20xx two-digit interpretation has no real-world use case here.
  if (yy < 0 || yy > 99) return yy;
  return 1900 + yy;
}

function parseFromDate(date: Date): string | null {
  if (!isValid(date)) return null;
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return toIsoString(y, m, d);
}

function parseExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const wholeDays = Math.floor(serial);
  // Excel counts from 1900-01-01 as serial 1; serials >= 60 skip the phantom 1900-02-29.
  const dayOffset = wholeDays < 60 ? wholeDays - 1 : wholeDays - 2;
  const date = new Date(EXCEL_DAY_ZERO_MS + dayOffset * 86_400_000);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return toIsoString(y, m, d);
}

function parseDelimitedDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\./g, "/").replace(/-/g, "/");
  const parts = normalized.split("/").map((p) => p.trim());
  if (parts.length !== 3) return null;

  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  let c = parseInt(parts[2], 10);
  if ([a, b, c].some((n) => Number.isNaN(n))) return null;

  let year: number;
  let month: number;
  let day: number;

  if (parts[0].length === 4) {
    year = a;
    month = b;
    day = c;
  } else {
    month = a;
    day = b;
    if (parts[2].length === 2) {
      year = expandTwoDigitYear(c);
    } else if (parts[2].length === 4) {
      year = c;
    } else {
      return null;
    }
  }

  return toIsoString(year, month, day);
}

/**
 * Parses user-facing DOB input into ISO `YYYY-MM-DD` for database storage.
 */
export function parseDOB(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input === "number") {
    return parseExcelSerial(input);
  }

  const str = String(input).trim();
  if (!str) return null;

  if (/^\d+(\.\d+)?$/.test(str)) {
    const serial = parseFloat(str);
    const fromSerial = parseExcelSerial(serial);
    if (fromSerial) return fromSerial;
  }

  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return parseIsoOrder(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10),
      parseInt(isoMatch[3], 10),
    );
  }

  if (/[/\-.]/.test(str)) {
    return parseDelimitedDate(str);
  }

  return null;
}

/**
 * Formats ISO `YYYY-MM-DD` as `MM/DD/YYYY` for record/identity contexts.
 */
export function formatDOB(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parse(iso, ISO_STORAGE, new Date());
  if (!isValid(d)) return "";
  return format(d, DISPLAY_FULL);
}

/**
 * Formats ISO `YYYY-MM-DD` as short birthday label (e.g. "May 12") for dashboard widgets.
 */
export function formatBirthdayShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parse(iso, ISO_STORAGE, new Date());
  if (!isValid(d)) return "";
  return format(d, DISPLAY_BIRTHDAY_SHORT);
}

/** CSV export helper — MM/DD/YYYY for round-trip re-import. */
export function formatDobForCsv(iso: string | null | undefined): string {
  return formatDOB(iso);
}
