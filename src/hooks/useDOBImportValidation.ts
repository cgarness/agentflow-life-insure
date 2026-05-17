import { useMemo, useCallback } from "react";
import { Lead } from "@/lib/types";
import { parseDOB, formatDOB } from "@/utils/dobUtils";

export type ImportRowAnalysis = {
  row: string[];
  rowNum: number;
  status: "ready" | "duplicate" | "error";
  errorMsg?: string;
  matchedLeadId?: string;
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function buildFieldToColIdx(mappings: Record<number, string>): Partial<Record<string, number>> {
  const fieldToColIdx: Partial<Record<string, number>> = {};
  Object.entries(mappings).forEach(([idx, field]) => {
    if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
  });
  return fieldToColIdx;
}

export function useDOBImportValidation(
  csvRows: string[][],
  mappings: Record<number, string>,
  existingLeads: Lead[],
) {
  const dobMapped = useMemo(
    () => Object.values(mappings).includes("Date of Birth"),
    [mappings],
  );

  const fieldToColIdx = useMemo(() => buildFieldToColIdx(mappings), [mappings]);

  const getRawDOB = useCallback(
    (row: string[]) => {
      const idx = fieldToColIdx["Date of Birth"];
      return idx !== undefined ? row[idx]?.trim() || "" : "";
    },
    [fieldToColIdx],
  );

  const formatPreviewDOB = useCallback((raw: string) => {
    if (!raw.trim()) return "";
    const iso = parseDOB(raw);
    return iso ? formatDOB(iso) : raw;
  }, []);

  const analysisResult = useMemo((): ImportRowAnalysis[] => {
    const results: ImportRowAnalysis[] = [];

    csvRows.forEach((row, i) => {
      const phoneIdx = fieldToColIdx["Phone"];
      const firstNameIdx = fieldToColIdx["First Name"];
      const lastNameIdx = fieldToColIdx["Last Name"];
      const fullNameIdx = fieldToColIdx["Full Name"];
      const emailIdx = fieldToColIdx["Email"];

      const phone = phoneIdx !== undefined ? row[phoneIdx]?.trim() : "";
      const firstName = firstNameIdx !== undefined ? row[firstNameIdx]?.trim() : "";
      const lastName = lastNameIdx !== undefined ? row[lastNameIdx]?.trim() : "";
      const fullName = fullNameIdx !== undefined ? row[fullNameIdx]?.trim() : "";
      const email = emailIdx !== undefined ? row[emailIdx]?.trim() : "";

      if (!phone) {
        results.push({ row, rowNum: i + 1, status: "error", errorMsg: "Phone is missing" });
        return;
      }
      if (!firstName && !lastName && !fullName) {
        results.push({ row, rowNum: i + 1, status: "error", errorMsg: "Name is missing" });
        return;
      }

      if (dobMapped) {
        const rawDob = getRawDOB(row);
        if (rawDob && parseDOB(rawDob) === null) {
          results.push({
            row,
            rowNum: i + 1,
            status: "error",
            errorMsg: "Invalid date of birth (use MM/DD/YYYY)",
          });
          return;
        }
      }

      const normalizedPhone = normalizePhone(phone);
      const normalizedEmail = email.toLowerCase();
      const dup = existingLeads.find(
        (l) =>
          (normalizedPhone && normalizePhone(l.phone) === normalizedPhone) ||
          (normalizedEmail && l.email.toLowerCase() === normalizedEmail),
      );

      if (dup) {
        results.push({ row, rowNum: i + 1, status: "duplicate", matchedLeadId: dup.id });
      } else {
        results.push({ row, rowNum: i + 1, status: "ready" });
      }
    });

    return results;
  }, [csvRows, fieldToColIdx, existingLeads, dobMapped, getRawDOB]);

  const parseDOBForImport = useCallback((raw: string): string | undefined => {
    if (!raw.trim()) return undefined;
    return parseDOB(raw) ?? undefined;
  }, []);

  return {
    analysisResult,
    dobMapped,
    fieldToColIdx,
    getRawDOB,
    formatPreviewDOB,
    parseDOBForImport,
  };
}
