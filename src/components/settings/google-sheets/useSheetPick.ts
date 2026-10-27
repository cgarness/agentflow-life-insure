import { useEffect, useRef, useState, type RefObject } from "react";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { pickSpreadsheet, preparePicker, PickerError } from "@/lib/google-sheets/picker";
import type { HeadersResult } from "@/lib/google-sheets/schema";
import type { PickResult } from "./SheetPickStep";

/** The mapping v2 dialog also receives the full `headers` response (columns, data flags, over-limit names). */
export type PickResultWithHeaders = PickResult & { headerInfo?: HeadersResult };

export interface PickTab { sheetId: number; title: string; configured: boolean }
export interface PickedFile { id: string; name: string; tabs: PickTab[] }

const LOAD_FAILED = "Couldn't load Google's file picker. Check your connection or allow this site in blockers, then try again.";
const PICKER_MESSAGES: Record<string, string> = {
  load_failed: LOAD_FAILED,
  load_timeout: LOAD_FAILED,
  picker_error: "Google couldn't open the file picker. Try again. If it keeps happening, tell your admin.",
  page_busy: "Couldn't open Google's file picker. Try again.",
};

const messageFor = (e: unknown) =>
  e instanceof SheetsApiError ? e.message : e instanceof PickerError ? PICKER_MESSAGES[e.code] : "Couldn't open Google. Try again.";

export const MODAL_RELEASE_TIMEOUT_MS = 3_000;

/**
 * Resolves once the dialog's modal layer is really gone: its content node is unmounted, the body pointer lock is
 * lifted, no Radix focus guards remain, and Radix's deferred focus-scope teardown (a 0 ms timer) has run.
 * Rejects with PickerError("page_busy") after `timeoutMs`, so the Picker is never shown under a live modal layer.
 */
export function waitForModalRelease(content: RefObject<HTMLElement | null>, timeoutMs = MODAL_RELEASE_TIMEOUT_MS): Promise<void> {
  const released = () => !content.current?.isConnected && document.body.style.pointerEvents !== "none"
    && !document.querySelector("[data-radix-focus-guard]");
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (released()) { setTimeout(() => (released() ? resolve() : poll()), 0); return; }
      if (Date.now() - started >= timeoutMs) { reject(new PickerError("page_busy")); return; }
      setTimeout(poll, 16);
    };
    poll();
  });
}

/**
 * Spreadsheet (Google Picker, drive.file) → tab. Lives in AddSheetDialog, which stays mounted while its dialog closes
 * for the Picker. The Picker token exists only inside `choose`; unmounting (identity change, navigation) disposes an
 * open Picker and drops every late result.
 */
export function useSheetPick(onPicked: (p: PickResultWithHeaders) => void, content: RefObject<HTMLElement | null>) {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); };
  }, []);

  const fail = (e: unknown) => {
    if (e instanceof PickerError) console.warn("[google-sheets] picker", e.code);
    if (alive.current) setError(messageFor(e));
  };

  const choose = async () => {
    setBusy(true); setOpening(true); setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await preparePicker();
      const { access_token } = await sheetsApi<{ access_token: string }>("picker_token");
      if (!alive.current) return;
      setPicking(true); // closes the dialog: a modal layer blocks every click and focus on the Picker
      await waitForModalRelease(content);
      if (!alive.current) return;
      const picked = await pickSpreadsheet(access_token, controller.signal);
      if (!alive.current) return;
      setPicking(false); setOpening(false);
      if (!picked) return;
      const info = await sheetsApi<{ name: string; tabs: PickTab[] }>("inspect", { spreadsheet_id: picked.id });
      if (alive.current) setFile({ id: picked.id, name: info.name || picked.name, tabs: info.tabs });
    } catch (e) { fail(e); } finally {
      if (abort.current === controller) abort.current = null;
      if (alive.current) { setPicking(false); setOpening(false); setBusy(false); }
    }
  };

  const chooseTab = async (t: PickTab) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const h = await sheetsApi<HeadersResult>("headers", { spreadsheet_id: file.id, sheet_id: t.sheetId });
      if (!alive.current) return;
      if (!h.header.some((x) => x.trim())) { setError("This tab has no header row."); return; }
      onPicked({ spreadsheetId: file.id, spreadsheetName: file.name, sheetId: t.sheetId, sheetTitle: h.title || t.title, headers: h.header,
                 headerInfo: h });
    } catch (e) { fail(e); } finally { if (alive.current) setBusy(false); }
  };

  return { file, busy, opening, picking, error, choose, chooseTab };
}

export type SheetPick = ReturnType<typeof useSheetPick>;
