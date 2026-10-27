import { useCallback, useEffect, useRef, useState } from "react";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import type { HeadersResult } from "@/lib/google-sheets/schema";

export type HeadersState =
  | { status: "loading" }
  | { status: "ready"; data: HeadersResult }
  | { status: "error"; message: string };

/**
 * The CURRENT header row of a tab (mapping v2). A just-picked tab starts from the picker's read; editing always reads
 * the sheet again. A failure is shown with Retry — the saved mapping is never presented as the sheet's columns.
 */
export function useSheetHeaders(target: { spreadsheetId: string; sheetId: number } | null, initial?: HeadersResult) {
  const [state, setState] = useState<HeadersState>(initial ? { status: "ready", data: initial } : { status: "loading" });
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    if (!target) return;
    const n = ++seq.current;
    setState({ status: "loading" });
    try {
      const data = await sheetsApi<HeadersResult>("headers", { spreadsheet_id: target.spreadsheetId, sheet_id: target.sheetId });
      if (alive.current && n === seq.current) setState({ status: "ready", data });
    } catch (e) {
      if (alive.current && n === seq.current) {
        setState({ status: "error", message: e instanceof SheetsApiError ? e.message : "Couldn't read the sheet's columns." });
      }
    }
  }, [target?.spreadsheetId, target?.sheetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new target uses the read that came with it (the picker's) or reads the sheet now (editing).
  useEffect(() => {
    if (!target) return;
    if (initial) setState({ status: "ready", data: initial }); else void load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return { state, retry: load };
}
