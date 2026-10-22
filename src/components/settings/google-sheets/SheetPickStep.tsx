import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { sheetsApi, SheetsApiError } from "@/lib/google-sheets/api";
import { pickSpreadsheet, pickerConfigured } from "@/lib/google-sheets/picker";

export interface PickResult { spreadsheetId: string; spreadsheetName: string; sheetId: number; sheetTitle: string; headers: string[] }
interface Tab { sheetId: number; title: string; configured: boolean }

/** Spreadsheet (Google Picker, drive.file) → tab. The Picker token lives only inside this call. */
const SheetPickStep: React.FC<{ onPicked: (p: PickResult) => void }> = ({ onPicked }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ id: string; name: string; tabs: Tab[] } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const fail = (e: unknown) => alive.current && setError(e instanceof SheetsApiError ? e.message : "Couldn't open Google. Try again.");

  const choose = async () => {
    setBusy(true); setError(null);
    try {
      const { access_token } = await sheetsApi<{ access_token: string }>("picker_token");
      const picked = await pickSpreadsheet(access_token);
      if (!picked || !alive.current) return;
      const info = await sheetsApi<{ name: string; tabs: Tab[] }>("inspect", { spreadsheet_id: picked.id });
      if (alive.current) setFile({ id: picked.id, name: info.name || picked.name, tabs: info.tabs });
    } catch (e) { fail(e); } finally { if (alive.current) setBusy(false); }
  };

  const chooseTab = async (t: Tab) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const h = await sheetsApi<{ header: string[]; title: string }>("headers", { spreadsheet_id: file.id, sheet_id: t.sheetId });
      if (!alive.current) return;
      if (!h.header.some((x) => x.trim())) { setError("This tab has no header row."); return; }
      onPicked({ spreadsheetId: file.id, spreadsheetName: file.name, sheetId: t.sheetId, sheetTitle: h.title || t.title, headers: h.header });
    } catch (e) { fail(e); } finally { if (alive.current) setBusy(false); }
  };

  if (!pickerConfigured()) return <p className="text-sm text-muted-foreground">Google Sheets is not available yet.</p>;
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={choose} disabled={busy}>{file ? "Choose another spreadsheet" : "Choose spreadsheet"}</Button>
      {file && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{file.name} — choose a tab</p>
          {file.tabs.map((t) => (
            <button
              key={t.sheetId}
              type="button"
              disabled={busy || t.configured}
              onClick={() => chooseTab(t)}
              className="w-full rounded-lg border p-2 text-left text-sm hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {t.title}{t.configured && <span className="ml-2 text-xs text-muted-foreground">Already added</span>}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
};

export default SheetPickStep;
