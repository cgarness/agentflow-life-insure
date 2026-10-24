import React from "react";
import { Button } from "@/components/ui/button";
import { pickerConfigured } from "@/lib/google-sheets/picker";
import type { SheetPick } from "./useSheetPick";

export interface PickResult { spreadsheetId: string; spreadsheetName: string; sheetId: number; sheetTitle: string; headers: string[] }

/** Spreadsheet → tab. The flow (and the Picker token) lives in useSheetPick, which survives the dialog closing. */
const SheetPickStep: React.FC<{ pick: SheetPick }> = ({ pick }) => {
  const { file, busy, opening, error, choose, chooseTab } = pick;
  if (!pickerConfigured()) return <p className="text-sm text-muted-foreground">Google Sheets is not available yet.</p>;
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={choose} disabled={busy}>
        {opening ? "Opening Google…" : file ? "Choose another spreadsheet" : "Choose spreadsheet"}
      </Button>
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
