import React, { useState, useRef, useCallback, useEffect } from "react";
import { Upload, X, Image, Globe, Clock, Palette, Phone, Building2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface BrandingState {
  companyName: string;
  logoUrl: string | null;
  logoName: string | null;
  faviconUrl: string | null;
  faviconName: string | null;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  primaryColor: string;
  companyPhone: string;
}

const DEFAULTS: BrandingState = {
  companyName: "",
  logoUrl: null,
  logoName: null,
  faviconUrl: null,
  faviconName: null,
  timezone: "America/Chicago",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12",
  primaryColor: "#3B82F6",
  companyPhone: "",
};

const TIMEZONES = [
  { group: "US & Canada", options: [
    { value: "America/New_York", label: "America/New_York (Eastern Time)" },
    { value: "America/Chicago", label: "America/Chicago (Central Time)" },
    { value: "America/Denver", label: "America/Denver (Mountain Time)" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific Time)" },
    { value: "America/Anchorage", label: "America/Anchorage (Alaska Time)" },
    { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii Time)" },
  ]},
  { group: "Other", options: [
    { value: "Europe/London", label: "Europe/London (GMT)" },
    { value: "Europe/Paris", label: "Europe/Paris (CET)" },
    { value: "Europe/Berlin", label: "Europe/Berlin (CET)" },
    { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
    { value: "Asia/Shanghai", label: "Asia/Shanghai (CST)" },
    { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
    { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
    { value: "America/Sao_Paulo", label: "America/Sao_Paulo (BRT)" },
  ]},
];

const DATE_FORMATS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (e.g. 03/15/2026)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (e.g. 15/03/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (e.g. 2026-03-15)" },
];

const TIME_FORMATS = [
  { value: "12", label: "12-Hour (e.g. 2:30 PM)" },
  { value: "24", label: "24-Hour (e.g. 14:30)" },
];

const COLOR_PRESETS = [
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
  "#EF4444", "#F97316", "#22C55E", "#0EA5E9",
];

const isValidHex = (hex: string) => /^#[0-9A-Fa-f]{6}$/.test(hex);

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const CompanyBranding: React.FC = () => {
  const [state, setState] = useState<BrandingState>({ ...DEFAULTS });
  const [saved, setSaved] = useState<BrandingState>({ ...DEFAULTS });
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [hexInput, setHexInput] = useState(DEFAULTS.primaryColor);
  const [hexError, setHexError] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const isDirty = JSON.stringify(state) !== JSON.stringify(saved);

  const update = useCallback((patch: Partial<BrandingState>) => {
    setState(prev => ({ ...prev, ...patch }));
    setNameError(false);
  }, []);

  // Unsaved changes warning handled by parent via prop — we expose isDirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "logo" | "favicon"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === "logo") {
      const validTypes = ["image/jpeg", "image/png", "image/svg+xml"];
      if (!validTypes.includes(file.type)) {
        toast({ title: "Invalid file type. Please upload a JPG, PNG, or SVG.", variant: "destructive" });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "File too large. Maximum size is 5MB.", variant: "destructive" });
        return;
      }
    } else {
      const validTypes = ["image/x-icon", "image/vnd.microsoft.icon", "image/png"];
      if (!validTypes.includes(file.type)) {
        toast({ title: "Invalid file type. Please upload an ICO or PNG.", variant: "destructive" });
        return;
      }
      if (file.size > 1 * 1024 * 1024) {
        toast({ title: "File too large. Maximum size is 1MB.", variant: "destructive" });
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      if (type === "logo") {
        update({ logoUrl: url, logoName: file.name });
      } else {
        update({ faviconUrl: url, faviconName: file.name });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSave = () => {
    if (!state.companyName.trim()) {
      setNameError(true);
      toast({ title: "Please fix the errors before saving", variant: "destructive" });
      return;
    }
    setSaving(true);
    setTimeout(() => {
      setSaved({ ...state });
      setSaving(false);
      toast({ title: "Company branding saved successfully" });
    }, 800);
  };

  const handleDrop = (e: React.DragEvent, type: "logo" | "favicon") => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const input = type === "logo" ? logoInputRef : faviconInputRef;
    const dt = new DataTransfer();
    dt.items.add(file);
    if (input.current) {
      input.current.files = dt.files;
      input.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const selectClasses = "w-full h-10 px-3 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/50 appearance-none cursor-pointer";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold" style={{ color: "#F1F5F9" }}>Company Branding</h3>
          <p className="text-sm" style={{ color: "#94A3B8" }}>Customize how your agency appears across AgentFlow</p>
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="px-5 py-2 rounded-md text-sm font-medium text-white flex items-center gap-2 transition-colors"
          style={{
            backgroundColor: isDirty && !saving ? "#3B82F6" : "#334155",
            cursor: isDirty && !saving ? "pointer" : "not-allowed",
            opacity: isDirty && !saving ? 1 : 0.7,
          }}
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Changes
        </button>
      </div>

      {/* Form Card */}
      <div className="rounded-lg p-6 space-y-6" style={{ backgroundColor: "#1E293B", border: "1px solid #334155" }}>

        {/* Company Name */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Company Name</label>
          <input
            type="text"
            value={state.companyName}
            onChange={e => {
              if (e.target.value.length <= 100) update({ companyName: e.target.value });
            }}
            placeholder="Enter your company name"
            className="w-full h-10 px-3 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/50"
            style={{ backgroundColor: "#334155", border: "1px solid #475569", color: "#F1F5F9" }}
          />
          {nameError && <p className="text-xs mt-1" style={{ color: "#EF4444" }}>Company name is required</p>}
        </div>

        {/* Company Logo */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Company Logo</label>
          {state.logoUrl ? (
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#334155" }}>
                <img src={state.logoUrl} alt="Logo" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-sm" style={{ color: "#F1F5F9" }}>{state.logoName}</p>
                <button onClick={() => update({ logoUrl: null, logoName: null })} className="text-xs mt-1 font-medium" style={{ color: "#EF4444" }}>Remove</button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => logoInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, "logo")}
              className="rounded-md p-6 text-center cursor-pointer transition-colors hover:opacity-80"
              style={{ border: "2px dashed #334155", backgroundColor: "transparent" }}
            >
              <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: "#64748B" }} />
              <p className="text-sm" style={{ color: "#94A3B8" }}>Drag and drop your logo here, or click to browse</p>
              <p className="text-xs mt-1" style={{ color: "#64748B" }}>JPG, PNG, SVG — max 5MB</p>
            </div>
          )}
          <input ref={logoInputRef} type="file" accept=".jpg,.jpeg,.png,.svg" className="hidden" onChange={e => handleFileUpload(e, "logo")} />
        </div>

        {/* Favicon */}
        <div>
          <label className="block text-sm font-medium mb-0.5" style={{ color: "#94A3B8" }}>Favicon</label>
          <p className="text-xs mb-2" style={{ color: "#64748B" }}>Shown in the browser tab. Use a square image for best results.</p>
          {state.faviconUrl ? (
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#334155" }}>
                <img src={state.faviconUrl} alt="Favicon" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-sm" style={{ color: "#F1F5F9" }}>{state.faviconName}</p>
                <button onClick={() => update({ faviconUrl: null, faviconName: null })} className="text-xs mt-1 font-medium" style={{ color: "#EF4444" }}>Remove</button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => faviconInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(e, "favicon")}
              className="rounded-md p-4 text-center cursor-pointer transition-colors hover:opacity-80"
              style={{ border: "2px dashed #334155", backgroundColor: "transparent" }}
            >
              <Image className="w-6 h-6 mx-auto mb-1.5" style={{ color: "#64748B" }} />
              <p className="text-sm" style={{ color: "#94A3B8" }}>Drag and drop your favicon here, or click to browse</p>
              <p className="text-xs mt-1" style={{ color: "#64748B" }}>ICO, PNG — max 1MB — recommended 64×64px</p>
            </div>
          )}
          <input ref={faviconInputRef} type="file" accept=".ico,.png" className="hidden" onChange={e => handleFileUpload(e, "favicon")} />
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Timezone</label>
          <select
            value={state.timezone}
            onChange={e => update({ timezone: e.target.value })}
            className={selectClasses}
            style={{ backgroundColor: "#334155", border: "1px solid #475569", color: "#F1F5F9" }}
          >
            {TIMEZONES.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Date Format */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Date Format</label>
          <select
            value={state.dateFormat}
            onChange={e => update({ dateFormat: e.target.value })}
            className={selectClasses}
            style={{ backgroundColor: "#334155", border: "1px solid #475569", color: "#F1F5F9" }}
          >
            {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {/* Time Format */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Time Format</label>
          <select
            value={state.timeFormat}
            onChange={e => update({ timeFormat: e.target.value })}
            className={selectClasses}
            style={{ backgroundColor: "#334155", border: "1px solid #475569", color: "#F1F5F9" }}
          >
            {TIME_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {/* Primary Color */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Primary Color</label>
          <Popover>
            <div className="flex items-center gap-3">
              <PopoverTrigger asChild>
                <button
                  className="w-10 h-10 rounded-md border cursor-pointer transition-transform hover:scale-105"
                  style={{ backgroundColor: state.primaryColor, borderColor: "#475569" }}
                />
              </PopoverTrigger>
              <input
                type="text"
                value={hexInput}
                onChange={e => {
                  const v = e.target.value;
                  setHexInput(v);
                  if (isValidHex(v)) {
                    setHexError(false);
                    update({ primaryColor: v });
                  } else {
                    setHexError(v.length === 7);
                  }
                }}
                maxLength={7}
                className="w-28 h-10 px-3 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/50"
                style={{ backgroundColor: "#334155", border: "1px solid #475569", color: "#F1F5F9" }}
              />
            </div>
            {hexError && <p className="text-xs mt-1" style={{ color: "#EF4444" }}>Invalid hex color</p>}
            <PopoverContent
              className="w-56 p-3"
              style={{ backgroundColor: "#1E293B", border: "1px solid #334155" }}
            >
              <div className="grid grid-cols-4 gap-2">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    onClick={() => {
                      update({ primaryColor: c });
                      setHexInput(c);
                      setHexError(false);
                    }}
                    className="w-10 h-10 rounded-md border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: state.primaryColor === c ? "#F1F5F9" : "transparent",
                    }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Company Phone */}
        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: "#94A3B8" }}>Company Phone</label>
          <input
            type="text"
            value={state.companyPhone}
            onChange={e => update({ companyPhone: formatPhone(e.target.value) })}
            placeholder="(555) 555-5555"
            className="w-full h-10 px-3 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/50"
            style={{ backgroundColor: "#334155", border: "1px solid #475569", color: "#F1F5F9" }}
          />
        </div>
      </div>
    </div>
  );
};

export default CompanyBranding;
