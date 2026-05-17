import { describe, it, expect } from "vitest";
import {
  parseDOB,
  formatDOB,
  formatBirthdayShort,
  formatDobForCsv,
} from "./dobUtils";

describe("parseDOB", () => {
  it("returns null for empty input", () => {
    expect(parseDOB(null)).toBeNull();
    expect(parseDOB(undefined)).toBeNull();
    expect(parseDOB("")).toBeNull();
    expect(parseDOB("   ")).toBeNull();
  });

  it("parses ISO YYYY-MM-DD", () => {
    expect(parseDOB("1983-05-12")).toBe("1983-05-12");
  });

  it("parses ISO with slashes YYYY/MM/DD", () => {
    expect(parseDOB("1983/05/12")).toBe("1983-05-12");
  });

  it("parses US MM/DD/YYYY", () => {
    expect(parseDOB("05/12/1983")).toBe("1983-05-12");
    expect(parseDOB("5/12/1983")).toBe("1983-05-12");
  });

  it("parses US MM-DD-YYYY", () => {
    expect(parseDOB("05-12-1983")).toBe("1983-05-12");
  });

  it("always resolves two-digit years to 19YY", () => {
    expect(parseDOB("05/12/83")).toBe("1983-05-12");
    expect(parseDOB("05/12/05")).toBe("1905-05-12");
    expect(parseDOB("01/01/99")).toBe("1999-01-01");
    expect(parseDOB("01/01/00")).toBe("1900-01-01");
  });

  it("parses Excel serial numbers", () => {
    expect(parseDOB(30819)).toBe("1984-05-16");
    expect(parseDOB("30819")).toBe("1984-05-16");
  });

  it("rejects invalid calendar dates", () => {
    expect(parseDOB("02/30/1985")).toBeNull();
    expect(parseDOB("13/01/1985")).toBeNull();
    expect(parseDOB("not-a-date")).toBeNull();
  });
});

describe("formatDOB", () => {
  it("formats ISO to MM/DD/YYYY", () => {
    expect(formatDOB("1983-05-12")).toBe("05/12/1983");
  });

  it("returns empty for null/invalid", () => {
    expect(formatDOB(null)).toBe("");
    expect(formatDOB("")).toBe("");
    expect(formatDOB("invalid")).toBe("");
  });
});

describe("formatBirthdayShort", () => {
  it("formats ISO to MMM d", () => {
    expect(formatBirthdayShort("1983-05-12")).toBe("May 12");
  });

  it("returns empty for null/invalid", () => {
    expect(formatBirthdayShort(null)).toBe("");
    expect(formatBirthdayShort("bad")).toBe("");
  });
});

describe("formatDobForCsv", () => {
  it("matches formatDOB for export round-trip", () => {
    expect(formatDobForCsv("1990-08-23")).toBe("08/23/1990");
    expect(formatDobForCsv("1990-08-23")).toBe(formatDOB("1990-08-23"));
  });
});

describe("round-trip", () => {
  it("parse then format US import sample", () => {
    const iso = parseDOB("05/12/83");
    expect(iso).toBe("1983-05-12");
    expect(formatDOB(iso)).toBe("05/12/1983");
  });
});
