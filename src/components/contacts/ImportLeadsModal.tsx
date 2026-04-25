import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  X, Upload, CloudUpload, ArrowLeft, ArrowRight, Check, AlertTriangle,
  FileText, Loader2, CheckCircle2, Download, RefreshCw, Plus, Megaphone, Settings, Users,
} from "lucide-react";
import { Lead, LeadStatus, CustomField, PipelineStage, LeadSource } from "@/lib/types";
import { TagInput } from "@/components/shared/TagInput";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { formatStateToAbbreviation } from "@/utils/stateUtils";
import { supabase } from "@/integrations/supabase/client";
import { addLeadsToCampaignBatched } from "@/lib/supabase-campaign-leads";
import { 
  customFieldsSupabaseApi as customFieldsApi,
  pipelineSupabaseApi,
  leadSourcesSupabaseApi
} from "@/lib/supabase-settings";

// ---- Types ----
type DuplicateHandling = "skip" | "update" | "import_new";
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

interface Conflict {
  imported_row: any;
  existing_db_row: any;
}

const AGENTFLOW_FIELDS = [
  "First Name", "Last Name", "Full Name", "Phone", "Email", "State", "Lead Source",
  "Age", "Date of Birth", "Best Time to Call", "Notes", "Assigned Agent",
] as const;

type AgentFlowField = typeof AGENTFLOW_FIELDS[number];

const FIELD_VARIATIONS: Record<AgentFlowField, string[]> = {
  "First Name": ["first name", "firstname", "first", "fname", "given name", "customer first name", "lead first name"],
  "Last Name": ["last name", "lastname", "last", "lname", "surname", "family name", "customer last name", "lead last name"],
  "Full Name": ["full name", "fullname", "name", "complete name", "contact name", "customer name", "lead name", "client name"],
  "Phone": ["phone", "phone number", "cell", "mobile", "telephone", "contact number", "primary phone", "cell phone", "work phone", "home phone"],
  "Email": ["email", "email address", "e-mail", "mail", "primary email", "contact email"],
  "State": ["state", "st", "province", "region", "location", "customer state", "shipping state", "billing state"],
  "Lead Source": ["lead source", "source", "how did you hear", "referral source", "origin", "marketing source", "traffic source"],
  "Age": ["age", "years old", "current age", "customer age"],
  "Date of Birth": ["date of birth", "dob", "birth date", "birthday", "birthdate"],
  "Best Time to Call": ["best time to call", "best time", "call time", "preferred time", "contact time", "callback time"],
  "Notes": ["notes", "note", "comments", "comment", "additional info", "remarks", "description", "details"],
  "Assigned Agent": ["assigned agent", "agent", "rep", "sales rep", "assigned to", "owner", "agent name", "staff"],
};

const TEMPLATE_HEADERS = [
  "First Name", "Last Name", "Phone", "Email", "State", "Lead Source",
  "Age", "Date of Birth", "Best Time to Call", "Notes",
];

const TEMPLATE_ROWS = [
  ["John", "Smith", "(555) 111-2222", "john.smith@email.com", "FL", "Facebook Ads", "42", "1983-05-12", "Morning", "Interested in term life"],
  ["Jane", "Doe", "(555) 333-4444", "jane.doe@email.com", "TX", "Referral", "35", "1990-08-23", "Afternoon", "Referred by Mike T."],
];

// Redundant LEAD_STATUSES removed

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  // Strip a UTF-8 BOM if present — Excel and other spreadsheet tools routinely
  // emit CSVs that begin with ﻿, which otherwise becomes an invisible
  // prefix on the first header and breaks the fuzzy-match against "First Name".
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // Handle escaped double-quote ("") inside a quoted field.
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim()); current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).filter(r => r.some(cell => cell.length > 0));
  return { headers, rows };
}

function fuzzyMatch(csvHeader: string): AgentFlowField | null {
  const h = csvHeader.toLowerCase().trim().replace(/[^a-z0-9]/g, " ");
  const normalizedH = h.replace(/\s+/g, "");

  // 1. Try exact match on field name or variations
  for (const [field, variations] of Object.entries(FIELD_VARIATIONS)) {
    const lowField = field.toLowerCase();
    if (h === lowField || normalizedH === lowField.replace(/\s+/g, "")) {
      return field as AgentFlowField;
    }
    if (variations.some(v => h === v || normalizedH === v.replace(/\s+/g, ""))) {
      return field as AgentFlowField;
    }
  }

  // 2. Try partial match with a stricter threshold
  for (const [field, variations] of Object.entries(FIELD_VARIATIONS)) {
    if (variations.some(v => {
      if (v.length <= 2) return h === v; // Don't partial match short codes like "st"
      return h.startsWith(v) || h.endsWith(v) || (h.includes(v) && v.length > 4);
    })) {
      return field as AgentFlowField;
    }
  }
  return null;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const uid = () => "l" + Math.random().toString(36).slice(2, 10);

// Campaign type for local use
interface CampaignOption {
  id: string;
  name: string;
  type: string;
  status: string;
}

// ---- Component ----
interface ImportLeadsModalProps {
  open: boolean;
  onClose: () => void;
  existingLeads: Lead[];
  onImportComplete: (newLeads: Lead[], historyEntry: ImportHistoryEntry, strategy: DuplicateHandling) => void;
  campaigns?: CampaignOption[];
  /** Create a real campaign row and return its id (used when user chooses "Create new campaign" before import). */
  onCampaignCreated?: (campaign: { name: string; type: string; description: string }) => Promise<{ id: string } | null>;
  organizationId?: string | null;
  currentUserId?: string;
  /** Shown next to "Assign to me" instead of the raw user id. */
  currentUserDisplayName?: string;
  agentProfiles?: { id: string; firstName: string; lastName: string }[];
}

const ImportLeadsModal: React.FC<ImportLeadsModalProps> = ({
  open,
  onClose,
  existingLeads,
  onImportComplete,
  campaigns = [],
  onCampaignCreated,
  organizationId = null,
  currentUserId = "u1",
  currentUserDisplayName = "",
  agentProfiles = [],
}) => {
  const [step, setStep] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Step 1
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);

  // Step 2
  const [mappings, setMappings] = useState<Record<number, string>>({});
  const [customFieldNames, setCustomFieldNames] = useState<string[]>([]);
  const [creatingFieldForCol, setCreatingFieldForCol] = useState<number | null>(null);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomField["type"]>("Text");
  const [newFieldDropdownOpts, setNewFieldDropdownOpts] = useState("");
  const [newFieldRequired, setNewFieldRequired] = useState(false);
  const [newFieldError, setNewFieldError] = useState("");

  // Step 3
  const [assignmentStrategy, setAssignmentStrategy] = useState<"self" | "specific_agent" | "round_robin">("self");
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  const [targetAgentIds, setTargetAgentIds] = useState<string[]>([]);
  const [campaignMode, setCampaignMode] = useState<"existing" | "new" | "none">("none");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignType, setNewCampaignType] = useState("Personal");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");
  const [importStatus, setImportStatus] = useState<string>("New");
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [sourceDropdownKey, setSourceDropdownKey] = useState(0);
  const [addingLeadSource, setAddingLeadSource] = useState(false);
  const [newLeadSourceDraft, setNewLeadSourceDraft] = useState("");
  const [savingLeadSource, setSavingLeadSource] = useState(false);

  // Step 4-5
  const [importProgress, setImportProgress] = useState(0);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number; errors: number; conflicts?: Conflict[] } | null>(null);
  const [resolvingIndex, setResolvingIndex] = useState(0);

  const reset = () => {
    setStep(1); setFile(null); setParsing(false); setCsvHeaders([]); setCsvRows([]);
    setMappings({}); setCustomFieldNames([]); setCreatingFieldForCol(null);
    setImportProgress(0); setImportResult(null); setResolvingIndex(0);
    setAssignmentStrategy("self"); setTargetAgentId(""); setTargetAgentIds([]);
    setCampaignMode("none"); setSelectedCampaignId(""); setNewCampaignName("");
    setNewCampaignType("Personal"); setNewCampaignDesc(""); 
    setImportStatus(pipelineStages.find(s => s.isDefault)?.name || "New");
    setSelectedSource("");
    setTags([]);
    setSourceDropdownKey(0);
    setAddingLeadSource(false);
    setNewLeadSourceDraft("");
    setSavingLeadSource(false);
  };

  // ---- Fetch Settings ----
  useEffect(() => {
    async function loadSettings() {
      try {
        const [stages, sources, fields] = await Promise.all([
          pipelineSupabaseApi.getLeadStages(),
          leadSourcesSupabaseApi.getAll(),
          customFieldsApi.getAll(organizationId),
        ]);
        setPipelineStages(stages);
        setLeadSources(sources);
        const leadCustomNames = fields
          .filter(f => f.active && Array.isArray(f.appliesTo) && f.appliesTo.includes("Leads"))
          .map(f => f.name);
        setCustomFieldNames(leadCustomNames);
        if (stages.length > 0) {
          const defaultStage = stages.find(s => s.isDefault) || stages[0];
          setImportStatus(defaultStage.name);
        }
      } catch (err) {
        console.error("Error loading settings in ImportLeadsModal:", err);
      }
    }
    if (open) loadSettings();
  }, [open, organizationId]);

  // Keep Lead Status select valid when pipeline stages load or change (avoids blank <select>).
  useEffect(() => {
    if (pipelineStages.length === 0) return;
    const names = pipelineStages.map(s => s.name);
    setImportStatus(prev => {
      if (names.includes(prev)) return prev;
      return (pipelineStages.find(s => s.isDefault) || pipelineStages[0]).name;
    });
  }, [pipelineStages]);

  // ---- CSV Parsing ----
  const handleFile = useCallback((f: File) => {
    const isCsv = f.name.toLowerCase().endsWith(".csv") || f.type === "text/csv";
    if (!isCsv) {
      toast.error("Unsupported file — please upload a .csv file");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast.error("File is too large — max size is 50MB");
      return;
    }
    if (f.size === 0) {
      toast.error("That CSV file is empty");
      return;
    }
    setFile(f);
    setParsing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) || "";
        const { headers, rows } = parseCSV(text);
        if (headers.length === 0) {
          toast.error("No columns found in CSV. Check that it has a header row.");
          setFile(null);
          setParsing(false);
          return;
        }
        if (rows.length === 0) {
          toast.error("No data rows found in CSV — only a header is present.");
          setFile(null);
          setParsing(false);
          return;
        }
        setCsvHeaders(headers);
        setCsvRows(rows);
        const autoMap: Record<number, string> = {};
        headers.forEach((h, i) => {
          const match = fuzzyMatch(h);
          autoMap[i] = match || "Do Not Import";
        });
        setMappings(autoMap);
      } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        toast.error(`Failed to parse CSV: ${err?.message || "unknown error"}`);
        setFile(null);
      } finally {
        setParsing(false);
      }
    };
    reader.onerror = () => {
      toast.error("Could not read the file — please try again");
      setFile(null);
      setParsing(false);
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

  // ---- All available fields (standard + custom) ----
  const allFields = useMemo(() => {
    return [...AGENTFLOW_FIELDS, ...customFieldNames];
  }, [customFieldNames]);

  // ---- Step 2 Validation ----
  const autoMatchedCount = useMemo(() => {
    return Object.values(mappings).filter(v => v !== "Do Not Import").length;
  }, [mappings]);

  const phoneIsMapped = useMemo(() => Object.values(mappings).includes("Phone"), [mappings]);
  const nameIsMapped = useMemo(() => 
    Object.values(mappings).includes("First Name") || 
    Object.values(mappings).includes("Last Name") ||
    Object.values(mappings).includes("Full Name"), 
    [mappings]
  );

  const duplicateMappings = useMemo(() => {
    const vals = Object.entries(mappings).filter(([, v]) => v !== "Do Not Import");
    const counts: Record<string, number[]> = {};
    vals.forEach(([i, v]) => { (counts[v] ??= []).push(Number(i)); });
    return Object.entries(counts).filter(([, indices]) => indices.length > 1).flatMap(([, indices]) => indices);
  }, [mappings]);

  const canContinueStep2 = phoneIsMapped && nameIsMapped && duplicateMappings.length === 0;

  const setMapping = (colIdx: number, value: string) => {
    if (value === "__create_new__") {
      setCreatingFieldForCol(colIdx);
      setNewFieldLabel(csvHeaders[colIdx] || "");
      setNewFieldType("Text");
      setNewFieldDropdownOpts("");
      setNewFieldRequired(false);
      setNewFieldError("");
      return;
    }
    setMappings(prev => ({ ...prev, [colIdx]: value }));
  };

  const handleCreateCustomField = async () => {
    if (!newFieldLabel.trim() || creatingFieldForCol === null) return;
    const trimmedName = newFieldLabel.trim();
    const allExistingNames = [
      ...(AGENTFLOW_FIELDS as readonly string[]),
      ...customFieldNames,
    ];
    if (allExistingNames.some(n => n.toLowerCase() === trimmedName.toLowerCase())) {
      setNewFieldError(`A field named "${trimmedName}" already exists.`);
      return;
    }
    setNewFieldError("");
    try {
      await customFieldsApi.create({
        name: trimmedName,
        type: newFieldType,
        appliesTo: ["Leads"],
        required: newFieldRequired,
        active: true,
        defaultValue: "",
        dropdownOptions: newFieldType === "Dropdown" ? newFieldDropdownOpts.split(",").map(s => s.trim()).filter(Boolean) : [],
      }, organizationId);
      setCustomFieldNames(prev => [...prev, trimmedName]);
      setMappings(prev => ({ ...prev, [creatingFieldForCol!]: trimmedName }));
      setCreatingFieldForCol(null);
      toast.success(`Custom field '${trimmedName}' created`);
    } catch (err: any) /* eslint-disable-line @typescript-eslint/no-explicit-any */ {
      toast.error(err.message || "Failed to create custom field");
    }
  };

  const cancelCreateField = () => {
    if (creatingFieldForCol !== null) {
      setMappings(prev => ({ ...prev, [creatingFieldForCol!]: "Do Not Import" }));
    }
    setCreatingFieldForCol(null);
    setNewFieldError("");
  };

  const autoDetectAgain = () => {
    const autoMap: Record<number, string> = {};
    csvHeaders.forEach((h, i) => {
      const match = fuzzyMatch(h);
      autoMap[i] = match || "Do Not Import";
    });
    setMappings(autoMap);
  };

  // ---- Step 3: Analyze Rows ----
  const analysisResult = useMemo(() => {
    const fieldToColIdx: Partial<Record<string, number>> = {};
    Object.entries(mappings).forEach(([idx, field]) => {
      if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
    });

    const results: { row: string[]; rowNum: number; status: "ready" | "duplicate" | "error"; errorMsg?: string; matchedLeadId?: string }[] = [];

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

      if (!phone) { results.push({ row, rowNum: i + 1, status: "error", errorMsg: "Phone is missing" }); return; }
      if (!firstName && !lastName && !fullName) { results.push({ row, rowNum: i + 1, status: "error", errorMsg: "Name is missing" }); return; }

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
  const importableCount = readyCount + dupCount; // Duplicates evaluated by Edge logic!

  // ---- Tags ----
  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
  };

  const saveNewLeadSourceInline = async () => {
    const name = newLeadSourceDraft.trim();
    if (!name) return;
    if (!organizationId) {
      toast.error("Organization is not loaded yet. Please try again in a moment.");
      return;
    }
    setSavingLeadSource(true);
    try {
      const nextOrder = leadSources.length === 0 ? 0 : Math.max(...leadSources.map(s => s.order), 0) + 1;
      const created = await leadSourcesSupabaseApi.create(
        { name, color: "#3B82F6", active: true, order: nextOrder },
        organizationId
      );
      setLeadSources(prev => [...prev, created].sort((a, b) => a.order - b.order));
      setSelectedSource(created.name);
      setAddingLeadSource(false);
      setNewLeadSourceDraft("");
      setSourceDropdownKey(k => k + 1);
      toast.success(`Lead source "${created.name}" saved`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save lead source";
      toast.error(msg);
    } finally {
      setSavingLeadSource(false);
    }
  };

  const assignToMeLabel = (() => {
    const fromProp = currentUserDisplayName?.trim();
    if (fromProp) return `Assign to me (${fromProp})`;
    const fromRoster = agentProfiles.find(p => p.id === currentUserId);
    if (fromRoster) {
      const n = `${fromRoster.firstName} ${fromRoster.lastName}`.trim();
      if (n) return `Assign to me (${n})`;
    }
    return "Assign to me";
  })();

  // ---- Filtered campaigns ----
  const filteredCampaigns = useMemo(() => {
    if (!campaignSearch) return campaigns;
    const q = campaignSearch.toLowerCase();
    return campaigns.filter(c => c.name.toLowerCase().includes(q));
  }, [campaigns, campaignSearch]);

  // ---- Step 4-5: Import ----
  const doImport = async () => {
    let resolvedCampaignId: string | undefined;

    if (campaignMode === "existing") {
      if (!selectedCampaignId) {
        toast.error("Select a campaign from the list, or choose a different campaign option.");
        return;
      }
      resolvedCampaignId = selectedCampaignId;
    } else if (campaignMode === "new") {
      if (!newCampaignName.trim()) {
        toast.error("Enter a name for the new campaign.");
        return;
      }
      if (!onCampaignCreated) {
        toast.error("Campaign creation is not available. Try again or contact support.");
        return;
      }
      const created = await onCampaignCreated({
        name: newCampaignName.trim(),
        type: newCampaignType,
        description: newCampaignDesc.trim(),
      });
      if (!created?.id) {
        toast.error("Could not create the campaign — import was not started.");
        return;
      }
      resolvedCampaignId = created.id;
    }

    setStep(4);
    setImportProgress(20);

    const fieldToColIdx: Partial<Record<string, number>> = {};
    Object.entries(mappings).forEach(([idx, field]) => {
      if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
    });

    const getVal = (row: string[], field: string) => {
      const idx = fieldToColIdx[field];
      return idx !== undefined ? row[idx]?.trim() || "" : "";
    };

    const contactData = analysisResult
      .filter(r => r.status === "ready" || r.status === "duplicate")
      .map(r => {
        const rawFullName = getVal(r.row, "Full Name");
        let firstName = getVal(r.row, "First Name");
        let lastName = getVal(r.row, "Last Name");

        if (!firstName && !lastName && rawFullName) {
          const split = splitFullName(rawFullName);
          firstName = split.firstName;
          lastName = split.lastName;
        }

        const customFieldsData: Record<string, any> = {
          ...(tags.length > 0 ? { tags } : {}),
          ...(rawFullName ? { "Full Name": rawFullName } : {}),
        };

        Object.entries(mappings).forEach(([idx, field]) => {
          if (field !== "Do Not Import" && !(AGENTFLOW_FIELDS as readonly string[]).includes(field) && field !== "Full Name") {
            const val = r.row[Number(idx)]?.trim();
            if (val) customFieldsData[field] = val;
          }
        });

        return {
          firstName, lastName, 
          phone: getVal(r.row, "Phone"), 
          email: getVal(r.row, "Email"),
          state: formatStateToAbbreviation(getVal(r.row, "State")), 
          status: importStatus,
          leadSource: selectedSource || getVal(r.row, "Lead Source"), 
          leadScore: 5,
          age: parseInt(getVal(r.row, "Age")) || undefined,
          dateOfBirth: getVal(r.row, "Date of Birth") || undefined,
          bestTimeToCall: getVal(r.row, "Best Time to Call") || undefined,
          notes: getVal(r.row, "Notes") || undefined,
          customFields: customFieldsData
        };
      });

    setImportProgress(60);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Your session has expired. Please refresh the page and try again.");
        setStep(3);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/import-contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            type: "leads",
            contactData,
            assignment: { strategy: assignmentStrategy, targetAgentId, targetAgentIds },
            duplicateDetectionRule: "phone_or_email",
          }),
        }
      );

      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Import failed (${response.status}) — non-JSON response from server`);
      }

      setImportProgress(100);

      if (!response.ok || !data?.success) {
        const detail = data?.stage ? ` [${data.stage}]` : "";
        throw new Error((data?.error || `Import failed (${response.status})`) + detail);
      }

      const insertedLeadIds: string[] = Array.isArray(data.inserted_lead_ids) ? data.inserted_lead_ids : [];
      if (resolvedCampaignId && insertedLeadIds.length > 0) {
        try {
          const { added, skipped } = await addLeadsToCampaignBatched(resolvedCampaignId, insertedLeadIds);
          if (skipped > 0) {
            toast.message(`Campaign: ${added} leads queued, ${skipped} skipped (rules or duplicates in queue).`, { duration: 5000 });
          }
        } catch (campErr: unknown) {
          const msg = campErr instanceof Error ? campErr.message : "Unknown error";
          toast.error(`Leads imported, but adding them to the campaign failed: ${msg}`);
        }
      }

      setImportResult({ 
        imported: data.imported, 
        duplicates: data.conflicts_count, 
        errors: errorCount, 
        conflicts: data.conflicts 
      });
      
      const historyEntry: ImportHistoryEntry = {
        id: Math.random().toString(36).slice(2, 10),
        fileName: file?.name || "unknown.csv",
        date: new Date().toISOString(),
        totalRecords: csvRows.length,
        imported: data.imported,
        duplicates: data.conflicts_count,
        errors: errorCount,
        importedLeadIds: [],
      };
      
      // Pass empty array for strategy for now
      onImportComplete([], historyEntry, "skip" as DuplicateHandling); 
      setStep(5);

    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
      setStep(3); // Go back on error
    }
  };

  if (!open) return null;

  // ---- Step 1 UI: Upload ----
  const renderStep1 = () => (
    <div className="flex flex-col items-center justify-center h-full">
      {!file ? (
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors duration-150 w-full ${
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
        <div className="border rounded-lg p-8 bg-muted/30 space-y-3 w-full">
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
        <div className="border rounded-lg p-6 bg-muted/30 w-full">
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
    </div>
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

      {/* Create Custom Field inline form */}
      {creatingFieldForCol !== null && (
        <div className="border border-primary/30 bg-muted/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Create Custom Field</h4>
            <button onClick={cancelCreateField} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Field Label *</label>
              <input
                value={newFieldLabel}
                onChange={e => { setNewFieldLabel(e.target.value); setNewFieldError(""); }}
                className={`w-full h-8 px-2 rounded-md bg-background text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none border ${newFieldError ? "border-destructive" : "border-border"}`}
                placeholder="Field name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Field Type</label>
              <select
                value={newFieldType}
                onChange={e => setNewFieldType(e.target.value as CustomField["type"])}
                className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
              >
                <option value="Text">Text</option>
                <option value="Number">Number</option>
                <option value="Date">Date</option>
                <option value="Email">Email</option>
                <option value="Phone">Phone number</option>
                <option value="Dropdown">Dropdown</option>
              </select>
            </div>
          </div>
          {newFieldType === "Dropdown" && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Options (comma-separated)</label>
              <input
                value={newFieldDropdownOpts}
                onChange={e => setNewFieldDropdownOpts(e.target.value)}
                className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                placeholder="Hot, Warm, Cold"
              />
            </div>
          )}
          {newFieldError && (
            <p className="text-xs text-destructive">{newFieldError}</p>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input type="checkbox" checked={newFieldRequired} onChange={e => setNewFieldRequired(e.target.checked)} className="rounded" />
              Required Field
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={cancelCreateField} className="h-8 px-3 rounded-md border border-border bg-background text-muted-foreground text-sm hover:bg-accent transition-colors duration-150">
              Cancel
            </button>
            <button
              onClick={handleCreateCustomField}
              disabled={!newFieldLabel.trim()}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors duration-150 disabled:opacity-40"
            >
              Create & Map Field
            </button>
          </div>
        </div>
      )}

      <div className="overflow-auto border rounded-lg scrollbar-thin scrollbar-thumb-muted-foreground/20" style={{ maxHeight: creatingFieldForCol !== null ? "250px" : "450px" }}>
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
              const isStandardField = (AGENTFLOW_FIELDS as readonly string[]).includes(mapped);
              const isAutoMatched = mapped !== "Do Not Import" && isStandardField && fuzzyMatch(header) === mapped;
              const isCustomField = mapped !== "Do Not Import" && !isStandardField && customFieldNames.includes(mapped);
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
                        onChange={e => setMapping(i, e.target.value)}
                        className={`h-8 px-2 rounded-md bg-muted text-foreground text-sm border focus:ring-2 focus:ring-primary/50 focus:outline-none transition-colors duration-150 ${
                          isDuplicate ? "border-destructive" : "border-border"
                        }`}
                      >
                        <option value="Do Not Import">Do Not Import</option>
                        {AGENTFLOW_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                        {customFieldNames.map(f => <option key={f} value={f}>{f} (Custom)</option>)}
                        <option disabled>──────────</option>
                        <option value="__create_new__" className="text-primary">➕ Create as new custom field...</option>
                      </select>
                      {isAutoMatched && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded-full whitespace-nowrap">Auto-matched</span>
                      )}
                      {isCustomField && (
                        <span className="text-xs px-1.5 py-0.5 bg-green-500/10 text-green-500 rounded-full whitespace-nowrap">Custom field</span>
                      )}
                      {!isAutoMatched && !isCustomField && mapped === "Do Not Import" && (
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
    const fieldToColIdx: Partial<Record<string, number>> = {};
    Object.entries(mappings).forEach(([idx, field]) => {
      if (field !== "Do Not Import") fieldToColIdx[field] = Number(idx);
    });
    const getVal = (row: string[], field: string) => {
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

        {/* Campaign Assignment */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Megaphone className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase text-muted-foreground tracking-wider">Campaign Assignment</span>
          </div>
          <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
            {/* Radio options */}
            {([
              { value: "existing" as const, label: "Add to existing campaign" },
              { value: "new" as const, label: "Create new campaign" },
              { value: "none" as const, label: "Don't assign to a campaign" },
            ]).map(opt => (
              <div key={opt.value}>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="radio"
                    name="campaignMode"
                    checked={campaignMode === opt.value}
                    onChange={() => setCampaignMode(opt.value)}
                    className="accent-primary"
                  />
                  {opt.label}
                </label>

                {/* Existing campaign dropdown */}
                {opt.value === "existing" && campaignMode === "existing" && (
                  <div className="ml-6 mt-2">
                    <input
                      value={campaignSearch}
                      onChange={e => setCampaignSearch(e.target.value)}
                      className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none mb-1"
                      placeholder="Search or select a campaign..."
                    />
                    <div className="max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 rounded-md bg-background border border-border">
                      {filteredCampaigns.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-2">No campaigns yet</p>
                      ) : filteredCampaigns.map(c => (
                        <button
                          key={c.id}
                          onClick={() => setSelectedCampaignId(c.id)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors duration-150 ${
                            selectedCampaignId === c.id ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <span className="flex-1">{c.name}</span>
                          <span className="text-xs px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{c.type}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            c.status === "Active" ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
                          }`}>{c.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* New campaign form */}
                {opt.value === "new" && campaignMode === "new" && (
                  <div className="ml-6 mt-2 space-y-2">
                    <input
                      value={newCampaignName}
                      onChange={e => setNewCampaignName(e.target.value)}
                      className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                      placeholder="Campaign Name *"
                    />
                    <select
                      value={newCampaignType}
                      onChange={e => setNewCampaignType(e.target.value)}
                      className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                    >
                      <option value="Open Pool">Open Pool</option>
                      <option value="Personal">Personal</option>
                      <option value="Team">Team</option>
                    </select>
                    <textarea
                      value={newCampaignDesc}
                      onChange={e => setNewCampaignDesc(e.target.value)}
                      className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none"
                      placeholder="Description (optional)"
                      rows={2}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Lead Settings */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase text-muted-foreground tracking-wider">Lead Settings</span>
          </div>
          <div className="border rounded-lg p-4 bg-muted/20 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Lead status for imported leads</label>
              <select
                value={importStatus}
                onChange={e => setImportStatus(e.target.value)}
                className="w-full max-w-md h-9 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
              >
                {pipelineStages.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
                {pipelineStages.length === 0 && (
                  <>
                    <option value="New">New</option>
                    <option value="Contacted">Contacted</option>
                  </>
                )}
              </select>
              <p className="text-xs text-muted-foreground mt-1">Every imported lead gets this pipeline stage.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Source</label>
              <select
                key={sourceDropdownKey}
                value={selectedSource}
                onChange={e => {
                  const v = e.target.value;
                  if (v === "__add_new__") {
                    setSourceDropdownKey(k => k + 1);
                    setAddingLeadSource(true);
                    setNewLeadSourceDraft("");
                    return;
                  }
                  setSelectedSource(v);
                }}
                className="w-full max-w-md h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
              >
                <option value="">{`Use CSV source (or "CSV Import")`}</option>
                {leadSources.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
                <option value="__divider__" disabled>──────────</option>
                <option value="__add_new__">+ Add new lead source…</option>
              </select>
              {addingLeadSource && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-xs text-muted-foreground mb-1 block">New lead source name</label>
                    <input
                      value={newLeadSourceDraft}
                      onChange={e => setNewLeadSourceDraft(e.target.value)}
                      className="w-full h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                      placeholder="e.g., Direct mail — term"
                      maxLength={80}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveNewLeadSourceInline()}
                    disabled={!newLeadSourceDraft.trim() || savingLeadSource}
                    className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
                  >
                    {savingLeadSource ? "Saving…" : "Save source"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingLeadSource(false); setNewLeadSourceDraft(""); }}
                    className="h-8 px-3 rounded-md border border-border bg-background text-muted-foreground text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Tags */}
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Add tags to all imported leads</label>
              <TagInput tags={tags} onChange={setTags} max={10} />
            </div>
          </div>
        </div>

        {/* Agent Assignment */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase text-muted-foreground tracking-wider">Agent Assignment</span>
          </div>
          <div className="border rounded-lg p-4 bg-muted/20 space-y-3">
            <p className="text-sm text-foreground">How should these contacts be assigned?</p>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input type="radio" checked={assignmentStrategy === "self"} onChange={() => setAssignmentStrategy("self")} className="accent-primary" />
                {assignToMeLabel}
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input type="radio" checked={assignmentStrategy === "specific_agent"} onChange={() => setAssignmentStrategy("specific_agent")} className="accent-primary" />
                Select specific agent
              </label>
              {assignmentStrategy === "specific_agent" && (
                <div className="ml-6">
                  <select 
                    value={targetAgentId} 
                    onChange={e => setTargetAgentId(e.target.value)}
                    className="w-full max-w-sm h-8 px-2 rounded-md bg-background border border-border text-foreground text-sm focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  >
                    <option value="">-- Choose an agent --</option>
                    {agentProfiles.map(p => (
                      <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer text-sm text-foreground">
                <input type="radio" checked={assignmentStrategy === "round_robin"} onChange={() => setAssignmentStrategy("round_robin")} className="accent-primary" />
                Round-robin across team
              </label>
              {assignmentStrategy === "round_robin" && (
                <div className="ml-6 space-y-2">
                  <p className="text-xs text-muted-foreground">Select agents to include in distribution:</p>
                  <div className="max-h-32 overflow-y-auto border border-border rounded-md bg-background p-2 grid gap-1">
                    {agentProfiles.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <input 
                          type="checkbox" 
                          checked={targetAgentIds.includes(p.id)}
                          onChange={(e) => {
                            if (e.target.checked) setTargetAgentIds(prev => [...prev, p.id]);
                            else setTargetAgentIds(prev => prev.filter(id => id !== p.id));
                          }}
                        />
                        {p.firstName} {p.lastName}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Preview Table */}
        <div className="overflow-auto max-h-[180px] border rounded-lg">
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
                    {r.status === "duplicate" && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 font-medium">Duplicate</span>}
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
    <div className="flex flex-col items-center justify-center h-full space-y-4">
      <Loader2 className="w-10 h-10 text-primary animate-spin" />
      <p className="text-foreground text-lg font-medium">Importing your leads...</p>
      <p className="text-muted-foreground text-sm">Please don't close this window</p>
      <div className="w-64">
        <Progress value={importProgress} className="h-2" />
      </div>
      <p className="text-xs text-muted-foreground">{importProgress}%</p>
    </div>
  );

  // ---- Step 5 UI: Result (or Duplicate Resolution) ----
  const renderStep5 = () => {
    if (!importResult) return <div />;

    const hasConflicts = (importResult.conflicts?.length || 0) > 0;
    const isResolving = hasConflicts && resolvingIndex < importResult.conflicts!.length;

    if (isResolving) {
      const conflict = importResult.conflicts![resolvingIndex];
      const existing = conflict.existing_db_row;
      const imported = conflict.imported_row;

      const handleResolve = async (action: "update" | "keep" | "skip") => {
        try {
          if (action === "update") {
            // Secure update merging new data into old lead
            await supabase.from("leads").update(imported).eq("id", existing.id);
          } else if (action === "keep") {
            // Force insert 
            await supabase.from("leads").insert([imported]);
          }
          // if skip, do nothing
          
          setResolvingIndex(prev => prev + 1);
        } catch (e: any) {
          toast.error("Resolution failed: " + e.message);
        }
      };

      return (
        <div className="space-y-6 pt-4">
          <div className="text-center">
            <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
            <h3 className="text-xl font-bold text-foreground">Duplicate Detected</h3>
            <p className="text-sm text-muted-foreground">Conflict {resolvingIndex + 1} of {importResult.conflicts!.length}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg bg-card overflow-hidden">
              <div className="bg-muted p-2 font-semibold text-center text-sm border-b">Existing Record</div>
              <div className="p-4 space-y-2 text-sm text-foreground">
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Name:</span> {existing.first_name} {existing.last_name}</p>
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Phone:</span> {existing.phone}</p>
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Email:</span> {existing.email}</p>
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Agent:</span> {existing.assigned_agent_id?.slice(0, 8) || "Unassigned"}</p>
              </div>
            </div>
            <div className="border rounded-lg overflow-hidden shadow-[0_0_15px_rgba(59,130,246,0.1)] border-primary/30 relative">
              <div className="absolute top-2 right-2 flex gap-1">
                 <span className="flex w-2 h-2 bg-primary rounded-full animate-pulse"></span>
              </div>
              <div className="bg-primary/10 text-primary p-2 font-semibold text-center text-sm border-b border-primary/20">Imported Row</div>
              <div className="p-4 space-y-2 text-sm text-foreground">
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Name:</span> {imported.first_name} {imported.last_name}</p>
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Phone:</span> {imported.phone}</p>
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Email:</span> {imported.email}</p>
                <p><span className="text-muted-foreground w-20 inline-block font-medium">Agent:</span> {imported.assigned_agent_id?.slice(0, 8) || "Unassigned"}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-6 justify-center">
             <button onClick={() => handleResolve("update")} className="px-4 py-2 border border-primary bg-primary/10 text-primary rounded-lg hover:bg-primary hover:text-white text-sm font-semibold sidebar-transition">
               Update Existing
             </button>
             <button onClick={() => handleResolve("keep")} className="px-4 py-2 border rounded-lg hover:bg-accent text-sm font-medium sidebar-transition text-foreground">
               Keep Both
             </button>
             <button onClick={() => handleResolve("skip")} className="px-4 py-2 border border-destructive/50 bg-destructive/5 text-destructive rounded-lg hover:bg-destructive hover:text-destructive-foreground text-sm font-medium sidebar-transition">
               Skip / Discard
             </button>
          </div>
        </div>
      );
    }

    // Success Screen when conflicts are fully resolved!
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
        </div>
        <h3 className="text-foreground text-xl font-semibold">Import Complete!</h3>
        <div className="space-y-1 text-center">
          <p className="text-sm text-green-500">{importResult?.imported} leads imported successfully</p>
          {(importResult?.duplicates || 0) > 0 && (
            <p className="text-sm text-yellow-500">{importResult?.duplicates} conflicts resolved</p>
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
  };

  // ---- Progress Bar ----
  const renderProgressBar = () => {
    if (step >= 4) return null;
    const steps = [
      { num: 1, label: "Upload" },
      { num: 2, label: "Map Fields" },
      { num: 3, label: "Review" },
    ];
    return (
      <div className="flex items-center justify-center gap-2 py-3">
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="fixed inset-0 bg-foreground/80 backdrop-blur-sm" onClick={step < 4 ? onClose : undefined} />
      {/* Fixed size modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col w-[860px] max-w-[95vw] max-h-[90vh] max-sm:w-screen max-sm:h-screen max-sm:min-w-0 max-sm:max-w-none max-sm:rounded-none">
        {/* Fixed Header */}
        {step < 5 && stepTitles[step].title && (
          <div className="flex items-start justify-between p-6 pb-0 shrink-0">
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

        <div className="px-6 shrink-0">{renderProgressBar()}</div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto px-6 min-h-0">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
        </div>

        {/* Fixed Footer */}
        {step >= 1 && step <= 3 && (
          <div className="flex items-center justify-between p-6 pt-4 border-t border-border shrink-0">
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
