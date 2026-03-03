import React, { useState, useRef, useCallback, useMemo } from "react";
import {
  X, Upload, CloudUpload, ArrowLeft, ArrowRight, Check, AlertTriangle,
  FileText, Loader2, CheckCircle2, Download, RefreshCw,
} from "lucide-react";
import { Lead } from "@/lib/types";
import { Progress } from "@/components/ui/progress";

// ---- Types ----
interface ImportHistoryEntry {
  id: string;
  fileName: string;
  date: string;
  totalRecords: number;
  imported: number;
  duplicates: number;
  errors: number;
  importedLeadIds: string[];
}

type DuplicateHandling = "skip" | "update" | "import_new";

const AGENTFLOW_FIELDS = [
  "First Name", "Last Name", "Phone", "Email", "State", "Lead Source",
  "Age", "Date of Birth", "Health Status", "Best Time to Call", "Notes", "Assigned Agent",
] as const;

type AgentFlowField = typeof AGENTFLOW_FIELDS[number];

const FIELD_VARIATIONS: Record<AgentFlowField, string[]> = {
  "First Name": ["first name", "firstname", "first", "fname", "given name"],
  "Last Name": ["last name", "lastname", "last", "lname", "surname", "family name"],
  "Phone": ["phone", "phone number", "cell", "mobile", "telephone", "contact number", "primary phone"],
  "Email": ["email", "email address", "e-mail", "mail"],
  "State": ["state", "st", "province", "region", "location"],
  "Lead Source": ["lead source", "source", "how did you hear", "referral source", "origin"],
  "Age": ["age", "years old", "current age"],
  "Date of Birth": ["date of birth", "dob", "birth date", "birthday"],
  "Health Status": ["health status", "health", "medical status", "condition"],
  "Best Time to Call": ["best time to call", "best time", "call time", "preferred time", "contact time"],
  "Notes": ["notes", "note", "comments", "comment", "additional info", "remarks"],
  "Assigned Agent": ["assigned agent", "agent", "rep", "sales rep", "assigned to", "owner"],
};

const TEMPLATE_HEADERS = [
  "First Name", "Last Name", "Phone", "Email", "State", "Lead Source",
  "Age", "Date of Birth", "Health Status", "Best Time to Call", "Notes",
];

const TEMPLATE_ROWS = [
  ["John", "Smith", "(555) 111-2222", "john.smith@email.com", "FL", "Facebook Ads", "42", "1983-05-12", "Preferred", "Morning", "Interested in term life"],
  ["Jane", "Doe", "(555) 333-4444", "jane.doe@email.com", "TX", "Referral", "35", "1990-08-23", "Standard", "Afternoon", "Referred by Mike T."],
];

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function fuzzyMatch(csvHeader: string): AgentFlowField | null {
  const h = csvHeader.toLowerCase().trim();
  for (const [field, variations] of Object.entries(FIELD_VARIATIONS)) {
    if (variations.some(v => h === v || h.includes(v) || v.includes(h))) {
      return field as AgentFlowField;
    }
  }
  return null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const uid = () => "l" + Math.random().toString(36).slice(2, 10);

// ---- Component ----
interface ImportLeadsModalProps {
  open: boolean;
  onClose: () => void;
  existingLeads: Lead[];
  onImportComplete: (newLeads: Lead[], historyEntry: ImportHistoryEntry) => void;
}

const ImportLeadsModal: React.FC<ImportLeadsModalProps> = ({ open, onClose, existingLeads, onImportComplete }) => {
  const [step, setStep] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Step 1
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);

  // Step 2
  const [mappings, setMappings] = useState<Record<number, AgentFlowField | "Do Not Import">>({});

  // Step 3
  const [duplicateHandling, setDuplicateHandling] = useState<DuplicateHandling>("skip");

  // Step 4-5
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: number } | null>(null);

  const reset = () => {
    setStep(1); setFile(null); setParsing(false); setCsvHeaders([]); setCsvRows([]);
    setMappings({}); setDuplicateHandling("skip"); setImportProgress(0); setImportResult(null);
  };

  // ---- CSV Parsing ----
  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".csv")) return;
    if (f.size > 50 * 1024 * 1024) return;
    setFile(f);
    setParsing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      setTimeout(() => {
        const text = e.target?.result as string;
        const { headers, rows } = parseCSV(text);
        setCsvHeaders(headers);
        setCsvRows(rows);
        // Auto-map
        const autoMap: Record<number, AgentFlowField | "Do Not Import"> = {};
        headers.forEach((h, i) => {
          const match = fuzzyMatch(h);
          autoMap[i] = match || "Do Not Import";
        });
        setMappings(autoMap);
        setParsing(false);
      }, 800);
    };
    reader.readAsText(f);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ---- Template Download ----
  const downloadTemplate = () => {
    const csvContent = [TEMPLATE_HEADERS.join(","), ...TEMPLATE_ROWS.map(r => r.map(v => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "agentflow_leads_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Step 2 Validation ----
  const autoMatchedCount = useMemo(() => {
    return Object.values(mappings).filter(v => v !== "Do Not Import").length;
  }, [mappings]);

  const phoneIsMapped = useMemo(() => Object.values(mappings).includes("Phone"), [mappings]);
  const nameIsMapped = useMemo(() => Object.values(mappings).includes("First Name") || Object.values(mappings).includes("Last Name"), [mappings]);

  const duplicateMappings = useMemo(() => {
    const vals = Object.entries(mappings).filter(([, v]) => v !== "Do Not Import");
    const counts: Record<string, number[]> = {};
    vals.forEach(([i, v]) => { (counts[v] ??= []).push(Number(i)); });
    return Object.entries(counts).filter(([, indices]) => indices.length > 1).flatMap(([, indices]) => indices);
  }, [mappings]);

  const canContinueStep2 = phoneIsMapped && nameIsMapped && duplicateMappings.length === 0;

  const setMapping = (colIdx: number, value: AgentFlowField | "Do Not Import") => {
    setMappings(prev => ({ ...prev, [colIdx]: value }));
  };

  const autoDetectAgain = () => {
    const autoMap: Record<number, AgentFlowField | "Do Not Import"> = {};
    csvHeaders.forEach((h, i) => {
      const match = fuzzyMatch(h);
      autoMap[i] = match || "Do Not Import";
    });
    setMappings(autoMap);
  };

  // ---- Step 3: Analyze Rows ----
  const analysisResult = useMemo(() => {
    const fieldToColIdx: Partial<Record<AgentFlowField, number>> = {};
    Object.entries(mappings).forEach(([idx, field]) => {
      if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
    });

    const results: { row: string[]; rowNum: number; status: "ready" | "duplicate" | "error"; errorMsg?: string; matchedLeadId?: string }[] = [];

    csvRows.forEach((row, i) => {
      const phoneIdx = fieldToColIdx["Phone"];
      const firstNameIdx = fieldToColIdx["First Name"];
      const lastNameIdx = fieldToColIdx["Last Name"];
      const emailIdx = fieldToColIdx["Email"];

      const phone = phoneIdx !== undefined ? row[phoneIdx]?.trim() : "";
      const firstName = firstNameIdx !== undefined ? row[firstNameIdx]?.trim() : "";
      const lastName = lastNameIdx !== undefined ? row[lastNameIdx]?.trim() : "";
      const email = emailIdx !== undefined ? row[emailIdx]?.trim() : "";

      // Check errors
      if (!phone) {
        results.push({ row, rowNum: i + 1, status: "error", errorMsg: "Phone is missing" });
        return;
      }
      if (!firstName && !lastName) {
        results.push({ row, rowNum: i + 1, status: "error", errorMsg: "Name is missing" });
        return;
      }

      // Check duplicates
      const normalizedPhone = normalizePhone(phone);
      const normalizedEmail = email.toLowerCase();
      const dup = existingLeads.find(l =>
        (normalizedPhone && normalizePhone(l.phone) === normalizedPhone) ||
        (normalizedEmail && l.email.toLowerCase() === normalizedEmail)
      );

      if (dup) {
        results.push({ row, rowNum: i + 1, status: "duplicate", matchedLeadId: dup.id });
      } else {
        results.push({ row, rowNum: i + 1, status: "ready" });
      }
    });

    return results;
  }, [csvRows, mappings, existingLeads]);

  const readyCount = analysisResult.filter(r => r.status === "ready").length;
  const dupCount = analysisResult.filter(r => r.status === "duplicate").length;
  const errorCount = analysisResult.filter(r => r.status === "error").length;
  const importableCount = readyCount + (duplicateHandling === "skip" ? 0 : dupCount);

  // ---- Step 4-5: Import ----
  const doImport = () => {
    setStep(4);
    setImportProgress(0);

    const fieldToColIdx: Partial<Record<AgentFlowField, number>> = {};
    Object.entries(mappings).forEach(([idx, field]) => {
      if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
    });

    const getVal = (row: string[], field: AgentFlowField) => {
      const idx = fieldToColIdx[field];
      return idx !== undefined ? row[idx]?.trim() || "" : "";
    };

    // Progress animation
    let progress = 0;
    const interval = setInterval(() => {
      progress += 2;
      setImportProgress(Math.min(progress, 100));
      if (progress >= 100) {
        clearInterval(interval);
        // Build leads
        const newLeads: Lead[] = [];
        let imported = 0, duplicates = 0, errors = 0;

        analysisResult.forEach(r => {
          if (r.status === "error") { errors++; return; }
          if (r.status === "duplicate" && duplicateHandling === "skip") { duplicates++; return; }
          if (r.status === "duplicate") { duplicates++; }

          if (r.status === "ready" || (r.status === "duplicate" && duplicateHandling !== "skip")) {
            const lead: Lead = {
              id: uid(),
              firstName: getVal(r.row, "First Name"),
              lastName: getVal(r.row, "Last Name"),
              phone: getVal(r.row, "Phone"),
              email: getVal(r.row, "Email"),
              state: getVal(r.row, "State"),
              status: "New",
              leadSource: getVal(r.row, "Lead Source") || "CSV Import",
              leadScore: 5,
              age: parseInt(getVal(r.row, "Age")) || undefined,
              dateOfBirth: getVal(r.row, "Date of Birth") || undefined,
              healthStatus: getVal(r.row, "Health Status") || undefined,
              bestTimeToCall: getVal(r.row, "Best Time to Call") || undefined,
              notes: getVal(r.row, "Notes") || undefined,
              assignedAgentId: "u1",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            newLeads.push(lead);
            imported++;
          }
        });

        const historyEntry: ImportHistoryEntry = {
          id: Math.random().toString(36).slice(2, 10),
          fileName: file?.name || "unknown.csv",
          date: new Date().toISOString(),
          totalRecords: csvRows.length,
          imported,
          duplicates,
          errors,
          importedLeadIds: newLeads.map(l => l.id),
        };

        setImportResult({ imported, duplicates, errors });
        onImportComplete(newLeads, historyEntry);
        setStep(5);
      }
    }, 30);
  };

  if (!open) return null;

  // ---- Step 1 UI: Upload ----
  const renderStep1 = () => (
    <>
      {!file ? (
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors duration-150 ${
            dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <CloudUpload className="w-8 h-8 text-primary mx-auto mb-3" />
          <p className="text-foreground text-base font-medium">Drop your CSV file here</p>
          <p className="text-muted-foreground text-sm mt-1">or click to browse files</p>
          <p className="text-muted-foreground/60 text-xs mt-3">Accepts .csv files only — max 50MB</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
        </div>
      ) : parsing ? (
        <div className="border rounded-lg p-8 bg-muted/30 space-y-3">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <span className="text-foreground font-medium">{file.name}</span>
            <span className="text-muted-foreground text-sm">{formatFileSize(file.size)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Processing...
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary/50 rounded-full animate-pulse w-2/3" />
          </div>
        </div>
      ) : (
        <div className="border rounded-lg p-6 bg-muted/30">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div className="flex-1">
              <p className="text-foreground font-medium">{file.name}</p>
              <p className="text-muted-foreground text-sm">{formatFileSize(file.size)} · {csvRows.length} rows detected</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <button onClick={() => { setFile(null); setCsvHeaders([]); setCsvRows([]); }} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <button onClick={downloadTemplate} className="flex items-center gap-2 text-sm text-primary hover:underline mt-3">
        <Download className="w-4 h-4" /> Need a template?
      </button>
    </>
  );

  // ---- Step 2 UI: Field Mapping ----
  const renderStep2 = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          <span className={autoMatchedCount === csvHeaders.length ? "text-green-500" : "text-yellow-500"}>
            {autoMatchedCount} of {csvHeaders.length} columns auto-matched
          </span>
        </p>
        <button onClick={autoDetectAgain} className="text-sm text-primary hover:underline flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Auto-detect again
        </button>
      </div>

      {!phoneIsMapped && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Phone is required to import leads. Please map a column to Phone before continuing.
        </div>
      )}
      {!nameIsMapped && phoneIsMapped && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Either First Name or Last Name must be mapped.
        </div>
      )}

      <div className="overflow-auto max-h-[360px] border rounded-lg">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b">
              <th className="text-left p-3 text-xs uppercase text-muted-foreground font-medium">Your CSV Columns</th>
              <th className="w-8"></th>
              <th className="text-left p-3 text-xs uppercase text-muted-foreground font-medium">AgentFlow Field</th>
              <th className="text-left p-3 text-xs uppercase text-muted-foreground font-medium">Preview</th>
            </tr>
          </thead>
          <tbody>
            {csvHeaders.map((header, i) => {
              const mapped = mappings[i];
              const isAutoMatched = mapped !== "Do Not Import" && fuzzyMatch(header) === mapped;
              const isDuplicate = duplicateMappings.includes(i);
              const previewVal = csvRows.find(r => r[i]?.trim())?.[i]?.trim() || "";

              return (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors duration-150">
                  <td className="p-3">
                    <span className="inline-block px-2.5 py-1 bg-muted rounded-md text-foreground text-xs font-medium">{header}</span>
                  </td>
                  <td className="text-center text-muted-foreground"><ArrowRight className="w-3.5 h-3.5 mx-auto" /></td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={mapped}
                        onChange={e => setMapping(i, e.target.value as AgentFlowField | "Do Not Import")}
                        className={`h-8 px-2 rounded-md bg-muted text-foreground text-sm border focus:ring-2 focus:ring-primary/50 focus:outline-none transition-colors duration-150 ${
                          isDuplicate ? "border-destructive" : "border-border"
                        }`}
                      >
                        <option value="Do Not Import">Do Not Import</option>
                        {AGENTFLOW_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                      {isAutoMatched && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded-full whitespace-nowrap">Auto-matched</span>
                      )}
                      {!isAutoMatched && mapped === "Do Not Import" && (
                        <span className="text-xs px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded-full whitespace-nowrap">Review needed</span>
                      )}
                      {isDuplicate && (
                        <span className="text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive rounded-full whitespace-nowrap">Already mapped</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs max-w-[120px] truncate">{previewVal.slice(0, 30)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ---- Step 3 UI: Review ----
  const renderStep3 = () => {
    const preview = analysisResult.slice(0, 10);
    const fieldToColIdx: Partial<Record<AgentFlowField, number>> = {};
    Object.entries(mappings).forEach(([idx, field]) => {
      if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
    });
    const getVal = (row: string[], field: AgentFlowField) => {
      const idx = fieldToColIdx[field];
      return idx !== undefined ? row[idx]?.trim() || "—" : "—";
    };

    return (
      <div className="space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Records", value: csvRows.length, color: "text-foreground" },
            { label: "Ready to Import", value: readyCount, color: "text-green-500" },
            { label: "Duplicates Found", value: dupCount, color: "text-yellow-500" },
            { label: "Rows with Errors", value: errorCount, color: "text-destructive" },
          ].map(c => (
            <div key={c.label} className="bg-muted/30 border rounded-lg p-3 text-center">
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
            </div>
          ))}
        </div>

        {/* Duplicate Handling */}
        {dupCount > 0 && (
          <div className="p-3 bg-muted/30 border rounded-lg space-y-2">
            <p className="text-sm font-medium text-foreground">What should we do with duplicates?</p>
            <div className="flex gap-2 flex-wrap">
              {([
                { value: "skip", label: "Skip duplicates" },
                { value: "update", label: "Update existing records" },
                { value: "import_new", label: "Import as new records" },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDuplicateHandling(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-150 ${
                    duplicateHandling === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Preview Table */}
        <div className="overflow-auto max-h-[280px] border rounded-lg">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                <th className="text-left p-2 text-xs text-muted-foreground font-medium">#</th>
                <th className="text-left p-2 text-xs text-muted-foreground font-medium">First Name</th>
                <th className="text-left p-2 text-xs text-muted-foreground font-medium">Last Name</th>
                <th className="text-left p-2 text-xs text-muted-foreground font-medium">Phone</th>
                <th className="text-left p-2 text-xs text-muted-foreground font-medium">State</th>
                <th className="text-left p-2 text-xs text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.map(r => (
                <tr key={r.rowNum} className="border-b last:border-0 hover:bg-muted/30 transition-colors duration-150">
                  <td className="p-2 text-muted-foreground">{r.rowNum}</td>
                  <td className="p-2 text-foreground">{getVal(r.row, "First Name")}</td>
                  <td className="p-2 text-foreground">{getVal(r.row, "Last Name")}</td>
                  <td className="p-2 text-foreground font-mono text-xs">{getVal(r.row, "Phone")}</td>
                  <td className="p-2 text-foreground">{getVal(r.row, "State")}</td>
                  <td className="p-2">
                    {r.status === "ready" && <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 font-medium">Ready</span>}
                    {r.status === "duplicate" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 font-medium">Duplicate</span>
                    )}
                    {r.status === "error" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium flex items-center gap-1 w-fit">
                        <AlertTriangle className="w-3 h-3" /> Error
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {csvRows.length > 10 && (
          <p className="text-xs text-muted-foreground text-center">Showing 10 of {csvRows.length} rows</p>
        )}

        {errorCount > 0 && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {errorCount} rows have errors and will be skipped. Fix your CSV and re-import to include them.
          </div>
        )}
      </div>
    );
  };

  // ---- Step 4 UI: Progress ----
  const renderStep4 = () => (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Loader2 className="w-10 h-10 text-primary animate-spin" />
      <p className="text-foreground text-lg font-medium">Importing your leads...</p>
      <p className="text-muted-foreground text-sm">Please don't close this window</p>
      <div className="w-64">
        <Progress value={importProgress} className="h-2" />
      </div>
      <p className="text-xs text-muted-foreground">{importProgress}%</p>
    </div>
  );

  // ---- Step 5 UI: Success ----
  const renderStep5 = () => (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
        <CheckCircle2 className="w-8 h-8 text-green-500" />
      </div>
      <h3 className="text-foreground text-xl font-semibold">Import Complete!</h3>
      <div className="space-y-1 text-center">
        <p className="text-sm text-green-500">{importResult?.imported} leads imported successfully</p>
        {(importResult?.duplicates || 0) > 0 && (
          <p className="text-sm text-yellow-500">{importResult?.duplicates} duplicates skipped</p>
        )}
        {(importResult?.errors || 0) > 0 && (
          <p className="text-sm text-destructive">{importResult?.errors} rows had errors and were skipped</p>
        )}
      </div>
      <div className="w-full max-w-xs space-y-2 pt-4">
        <button onClick={() => { reset(); onClose(); }} className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors duration-150">
          View Leads
        </button>
        <button onClick={reset} className="w-full h-10 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-accent transition-colors duration-150">
          Import Another File
        </button>
      </div>
    </div>
  );

  // ---- Progress Bar ----
  const renderProgressBar = () => {
    if (step >= 4) return null;
    const steps = [
      { num: 1, label: "Upload" },
      { num: 2, label: "Map Fields" },
      { num: 3, label: "Review" },
    ];
    return (
      <div className="flex items-center justify-center gap-2 mb-4">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            <div className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors duration-150 ${
                step >= s.num ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{s.num}</div>
              <span className={`text-xs font-medium ${step >= s.num ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <div className={`w-12 h-px ${step > s.num ? "bg-primary" : "bg-border"}`} />}
          </React.Fragment>
        ))}
      </div>
    );
  };

  const stepTitles: Record<number, { title: string; sub: string }> = {
    1: { title: "Import Leads", sub: "Upload a CSV file to import leads into AgentFlow" },
    2: { title: "Map Your Fields", sub: "Match your CSV columns to AgentFlow lead fields" },
    3: { title: "Review Your Import", sub: "Review and confirm before importing" },
    4: { title: "Importing...", sub: "" },
    5: { title: "", sub: "" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="fixed inset-0 bg-foreground/80 backdrop-blur-sm" onClick={step < 4 ? onClose : undefined} />
      <div className={`relative bg-card border border-border rounded-xl shadow-2xl w-full p-6 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto ${
        step === 3 ? "max-w-[900px]" : "max-w-[680px]"
      }`}>
        {/* Header */}
        {step < 5 && stepTitles[step].title && (
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              {step > 1 && step < 4 && (
                <button onClick={() => setStep(step - 1)} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div>
                <h2 className="text-xl font-semibold text-foreground">{stepTitles[step].title}</h2>
                {stepTitles[step].sub && <p className="text-sm text-muted-foreground mt-0.5">{stepTitles[step].sub}</p>}
              </div>
            </div>
            {step < 4 && (
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {renderProgressBar()}

        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
        {step === 5 && renderStep5()}

        {/* Footer */}
        {step >= 1 && step <= 3 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
            <button onClick={onClose} className="h-9 px-4 rounded-lg border border-border bg-background text-muted-foreground text-sm font-medium hover:bg-accent hover:text-foreground transition-colors duration-150">
              Cancel
            </button>
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={!file || parsing || csvRows.length === 0}
                className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none"
              >
                Continue
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                disabled={!canContinueStep2}
                className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none"
              >
                Continue to Review
              </button>
            )}
            {step === 3 && (
              <button
                onClick={doImport}
                disabled={importableCount === 0}
                className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none"
              >
                Import {importableCount} Leads
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportLeadsModal;
export type { ImportHistoryEntry };
