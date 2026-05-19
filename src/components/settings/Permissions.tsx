
import React, { useState, useCallback, useEffect } from "react";
import {
  Lock, LayoutGrid, SlidersHorizontal, Database, DollarSign,
  ChevronDown, Info, BarChart3, Phone, Users, MessageSquare,
  Calendar, Megaphone, Trophy, FileText, Bot, GraduationCap,
  FolderOpen, Loader2
} from "lucide-react";
import {
  DEFAULT_SETTINGS_SECTIONS,
  mergeSettingsSections,
  type SettingsSectionPermission,
} from "@/config/permissionDefaults";
import { SETTINGS_CONFIG } from "@/config/settingsConfig";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
/*
 * Role name mapping:
 *   UI camelCase key  →  DB value (profiles.role / role_permissions.role)
 *   "agent"           →  "Agent"
 *   "teamLeader"      →  "Team Leader"
 *   "admin"           →  "Admin"       (full access, never written to role_permissions)
 *
 * The roleMap object in handleSave() translates camelCase → Title Case for DB writes.
 * Canonical role strings: 'Agent', 'Team Leader', 'Admin' (Title Case everywhere in DB).
 */
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Role = "agent" | "teamLeader" | "admin";
type DataScope = "own" | "team" | "all";

interface PageAccess {
  name: string;
  icon: React.ElementType;
  agent: boolean;
  teamLeader: boolean;
}

interface FeaturePerm {
  name: string;
  description: string;
  agent: boolean;
  teamLeader: boolean;
}

interface FeatureCategory {
  category: string;
  features: FeaturePerm[];
}

interface DataAccessItem {
  label: string;
  description: string;
  agent: DataScope;
  teamLeader: DataScope;
}

interface CommissionPerm {
  name: string;
  description: string;
  agent: boolean;
  teamLeader: boolean;
}

const defaultPages: PageAccess[] = [
  { name: "Dashboard", icon: BarChart3, agent: true, teamLeader: true },
  { name: "Dialer", icon: Phone, agent: true, teamLeader: true },
  { name: "Contacts", icon: Users, agent: true, teamLeader: true },
  { name: "Conversations", icon: MessageSquare, agent: true, teamLeader: true },
  { name: "Calendar", icon: Calendar, agent: true, teamLeader: true },
  { name: "Campaigns", icon: Megaphone, agent: true, teamLeader: true },
  { name: "Leaderboard", icon: Trophy, agent: true, teamLeader: true },
  { name: "Reports", icon: FileText, agent: false, teamLeader: true },
  { name: "AI Agents", icon: Bot, agent: false, teamLeader: true },
  { name: "Training", icon: GraduationCap, agent: true, teamLeader: true },
  { name: "Resources", icon: FolderOpen, agent: true, teamLeader: true },
];

const defaultFeatures: FeatureCategory[] = [
  {
    category: "Contacts",
    features: [
      { name: "Import Leads", description: "Upload CSV files to add leads in bulk", agent: false, teamLeader: true },
      { name: "Export Contacts", description: "Download contacts as CSV", agent: false, teamLeader: true },
      { name: "Delete Contacts", description: "Permanently delete lead, client, or recruit records", agent: false, teamLeader: false },
      { name: "Merge Contacts", description: "Merge duplicate contact records", agent: false, teamLeader: true },
      { name: "Bulk Actions", description: "Assign, status change, or delete multiple contacts at once", agent: true, teamLeader: true },
      { name: "Edit Any Contact", description: "Edit contacts assigned to other agents", agent: false, teamLeader: true },
      { name: "View Contact Owner", description: "See which agent a contact is assigned to", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Campaigns",
    features: [
      { name: "Create Campaigns", description: "Build new dialer campaigns", agent: false, teamLeader: true },
      { name: "Edit Campaigns", description: "Modify existing campaigns", agent: false, teamLeader: true },
      { name: "Delete Campaigns", description: "Remove campaigns permanently", agent: false, teamLeader: false },
      { name: "Upload Campaign Leads", description: "Add leads to Open Pool campaigns", agent: false, teamLeader: true },
      { name: "View All Campaigns", description: "See campaigns created by other agents", agent: false, teamLeader: true },
      { name: "View Campaign Import History", description: "See the log of when and how leads were added to a campaign", agent: false, teamLeader: true },
    ],
  },
  {
    category: "Dialer",
    features: [
      { name: "Skip Leads", description: "Skip a lead in the dialer without calling", agent: true, teamLeader: true },
      { name: "Override DNC", description: "Call a number even if it is on the DNC list", agent: false, teamLeader: false },
      { name: "Manual Dial", description: "Type in a number and call outside of a campaign", agent: true, teamLeader: true },
      { name: "End Session Early", description: "End a dialer session before the campaign is complete", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Reports",
    features: [
      { name: "View Own Reports", description: "See reports filtered to own activity only", agent: true, teamLeader: true },
      { name: "View Team Reports", description: "See reports across all team members", agent: false, teamLeader: true },
      { name: "Export Reports", description: "Download reports as CSV or PDF", agent: false, teamLeader: true },
    ],
  },
  {
    category: "Leaderboard",
    features: [
      { name: "View Leaderboard", description: "See the team leaderboard", agent: true, teamLeader: true },
      { name: "View Other Agent Stats", description: "See detailed stats of other agents on the leaderboard", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Calendar",
    features: [
      { name: "Create Appointments", description: "Schedule new appointments", agent: true, teamLeader: true },
      { name: "Edit Any Appointment", description: "Modify appointments set by other agents", agent: false, teamLeader: true },
      { name: "Delete Appointments", description: "Remove appointments", agent: true, teamLeader: true },
    ],
  },
  {
    category: "AI Agents",
    features: [
      { name: "Create AI Agents", description: "Build and configure AI agents", agent: false, teamLeader: false },
      { name: "Run AI Agents", description: "Activate AI agents on campaigns", agent: false, teamLeader: true },
      { name: "View AI Conversations", description: "See AI agent conversation logs", agent: true, teamLeader: true },
    ],
  },
  {
    category: "Training",
    features: [
      { name: "Mark Complete", description: "Mark training resources as completed", agent: true, teamLeader: true },
      { name: "Add Resources", description: "Upload new training materials", agent: false, teamLeader: false },
    ],
  },
];

const defaultDataAccess: DataAccessItem[] = [
  { label: "Leads & Contacts", description: "Which contact records can this role view and interact with?", agent: "own", teamLeader: "team" },
  { label: "Calls & Recordings", description: "Which call history and recordings can this role access?", agent: "own", teamLeader: "team" },
  { label: "Campaigns", description: "Which campaigns can this role view and work within?", agent: "own", teamLeader: "team" },
  { label: "Dashboard & Reports", description: "Which data appears on the dashboard and in reports?", agent: "own", teamLeader: "team" },
];

const defaultCommission: CommissionPerm[] = [
  { name: "View Own Commission Percentage", description: "See their own commission rate", agent: true, teamLeader: true },
  { name: "View Others' Commission Percentage", description: "See commission rates of other agents", agent: false, teamLeader: false },
  { name: "View Per-Policy Commission", description: "See earnings per individual policy", agent: true, teamLeader: true },
  { name: "View Monthly Commission Total", description: "See total commission earned this month", agent: true, teamLeader: true },
  { name: "View Team Commission Totals", description: "See combined commission across all team members", agent: false, teamLeader: true },
  { name: "View Commission in Reports", description: "See commission data in the Reports section", agent: false, teamLeader: true },
];

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Diff + activity log helpers
// ---------------------------------------------------------------------------

type DiffEntry = { name: string; from: unknown; to: unknown };

function buildPermissionDiff(
  savedSnap: string,
  currentSnap: string,
  roleKey: "agent" | "teamLeader"
): { changed_keys: string[]; diff: Record<string, DiffEntry[]> } {
  if (!savedSnap) return { changed_keys: [], diff: {} };
  const before = JSON.parse(savedSnap);
  const after = JSON.parse(currentSnap);
  const result: Record<string, DiffEntry[]> = {};

  const pd = (after.p as PageAccess[]).reduce<DiffEntry[]>((acc, p, i) => {
    const b = before.p?.[i];
    if (b && b[roleKey] !== p[roleKey]) acc.push({ name: p.name, from: b[roleKey], to: p[roleKey] });
    return acc;
  }, []);
  if (pd.length) result.pages = pd;

  const fd = (after.f as FeatureCategory[]).flatMap((cat, ci) =>
    cat.features.reduce<DiffEntry[]>((acc, f, fi) => {
      const b = before.f?.[ci]?.features?.[fi];
      if (b && b[roleKey] !== f[roleKey]) acc.push({ name: f.name, from: b[roleKey], to: f[roleKey] });
      return acc;
    }, [])
  );
  if (fd.length) result.features = fd;

  const dd = (after.d as DataAccessItem[]).reduce<DiffEntry[]>((acc, d, i) => {
    const b = before.d?.[i];
    if (b && b[roleKey] !== d[roleKey]) acc.push({ name: d.label, from: b[roleKey], to: d[roleKey] });
    return acc;
  }, []);
  if (dd.length) result.data_access = dd;

  const cd = (after.c as CommissionPerm[]).reduce<DiffEntry[]>((acc, c, i) => {
    const b = before.c?.[i];
    if (b && b[roleKey] !== c[roleKey]) acc.push({ name: c.name, from: b[roleKey], to: c[roleKey] });
    return acc;
  }, []);
  if (cd.length) result.commission = cd;

  const sd = (after.s as SettingsSectionPermission[]).reduce<DiffEntry[]>((acc, row, i) => {
    const b = before.s?.[i];
    if (b && b[roleKey] !== row[roleKey]) acc.push({ name: row.label, from: b[roleKey], to: row[roleKey] });
    return acc;
  }, []);
  if (sd.length) result.settings_sections = sd;

  return { changed_keys: Object.keys(result), diff: result };
}

async function writeActivityLog(
  orgId: string,
  userId: string,
  userName: string,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>
) {
  try {
    await supabase.from("activity_logs").insert({
      organization_id: orgId,
      user_id: userId,
      user_name: userName,
      action,
      entity_type: "role_permissions",
      entity_id: entityId,
      metadata,
    });
  } catch (err) {
    console.error("[Permissions] Activity log write failed:", err);
  }
}

// ---------------------------------------------------------------------------
// UI sub-components
// ---------------------------------------------------------------------------

const AccordionSection: React.FC<{
  title: string;
  description: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, description, icon: Icon, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <ChevronDown
          className="w-4 h-4 text-muted-foreground transition-transform duration-200"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <div
        className="overflow-hidden transition-all duration-300"
        style={{ maxHeight: open ? "5000px" : "0px", opacity: open ? 1 : 0 }}
      >
        <div className="px-4 pb-4">{children}</div>
      </div>
    </div>
  );
};

const DataScopePills: React.FC<{ value: DataScope; onChange: (v: DataScope) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => {
  const opts: { val: DataScope; label: string }[] = [
    { val: "own", label: "Own Only" },
    { val: "team", label: "Team Only" },
    { val: "all", label: "All Agents" },
  ];
  return (
    <div className="flex rounded-lg overflow-hidden border">
      {opts.map((o) => (
        <button
          key={o.val}
          disabled={disabled}
          onClick={() => !disabled && onChange(o.val)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            value === o.val
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground"
          } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
};

const ROLE_MAP: Record<string, string> = { agent: "Agent", teamLeader: "Team Leader" };

const Permissions: React.FC = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [activeRole, setActiveRole] = useState<Role>("agent");
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; desc: string; onConfirm: () => void }>({ open: false, title: "", desc: "", onConfirm: () => {} });
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  const [agentPages, setAgentPages] = useState(() => defaultPages.map((p) => ({ ...p })));
  const [tlPages, setTlPages] = useState(() => defaultPages.map((p) => ({ ...p })));
  const [agentFeatures, setAgentFeatures] = useState(() => deepClone(defaultFeatures));
  const [tlFeatures, setTlFeatures] = useState(() => deepClone(defaultFeatures));
  const [agentData, setAgentData] = useState(() => deepClone(defaultDataAccess));
  const [tlData, setTlData] = useState(() => deepClone(defaultDataAccess));
  const [agentCommission, setAgentCommission] = useState(() => deepClone(defaultCommission));
  const [tlCommission, setTlCommission] = useState(() => deepClone(defaultCommission));
  const [agentSettings, setAgentSettings] = useState(() =>
    DEFAULT_SETTINGS_SECTIONS.map((row) => ({ ...row }))
  );
  const [tlSettings, setTlSettings] = useState(() =>
    DEFAULT_SETTINGS_SECTIONS.map((row) => ({ ...row }))
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [savedAgent, setSavedAgent] = useState("");
  const [savedTl, setSavedTl] = useState("");

  const currentSnapshot = useCallback(() => {
    if (activeRole === "agent") {
      return JSON.stringify({ p: agentPages, f: agentFeatures, d: agentData, c: agentCommission, s: agentSettings });
    }
    if (activeRole === "teamLeader") {
      return JSON.stringify({ p: tlPages, f: tlFeatures, d: tlData, c: tlCommission, s: tlSettings });
    }
    return "";
  }, [
    activeRole,
    agentPages,
    agentFeatures,
    agentData,
    agentCommission,
    agentSettings,
    tlPages,
    tlFeatures,
    tlData,
    tlCommission,
    tlSettings,
  ]);

  const loadPermissions = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("*")
        .eq("organization_id", profile.organization_id);
      if (error) throw error;

      data?.forEach((row) => {
        const perms = row.permissions as Record<string, unknown>;
        const snap = JSON.stringify(perms);
        if (row.role === "Agent") {
          setSavedAgent(snap);
          if (Array.isArray(perms.p)) setAgentPages(perms.p as PageAccess[]);
          if (Array.isArray(perms.f)) setAgentFeatures(perms.f as FeatureCategory[]);
          if (Array.isArray(perms.d)) setAgentData(perms.d as DataAccessItem[]);
          if (Array.isArray(perms.c)) setAgentCommission(perms.c as CommissionPerm[]);
          setAgentSettings(mergeSettingsSections(perms.s as SettingsSectionPermission[]));
        } else if (row.role === "Team Leader") {
          setSavedTl(snap);
          if (Array.isArray(perms.p)) setTlPages(perms.p as PageAccess[]);
          if (Array.isArray(perms.f)) setTlFeatures(perms.f as FeatureCategory[]);
          if (Array.isArray(perms.d)) setTlData(perms.d as DataAccessItem[]);
          if (Array.isArray(perms.c)) setTlCommission(perms.c as CommissionPerm[]);
          setTlSettings(mergeSettingsSections(perms.s as SettingsSectionPermission[]));
        }
      });
    } catch (err) {
      console.error(err);
      toast({ title: "Failed to load permissions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_id]);

  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  const isDirty = useCallback(() => {
    if (activeRole === "admin") return false;
    const snap = currentSnapshot();
    return snap !== (activeRole === "agent" ? savedAgent : savedTl);
  }, [activeRole, currentSnapshot, savedAgent, savedTl]);

  const switchRole = (role: Role) => {
    if (role === activeRole) return;
    if (isDirty()) {
      setPendingRole(role);
      setConfirmDialog({
        open: true,
        title: "Unsaved Changes",
        desc: `You have unsaved changes to ${activeRole === "agent" ? "Agent" : "Team Leader"} permissions. Leave without saving?`,
        onConfirm: () => {
          if (activeRole === "agent") {
            const s = JSON.parse(savedAgent);
            setAgentPages(s.p); setAgentFeatures(s.f); setAgentData(s.d); setAgentCommission(s.c);
            setAgentSettings(s.s ?? DEFAULT_SETTINGS_SECTIONS.map((row) => ({ ...row })));
          } else {
            const s = JSON.parse(savedTl);
            setTlPages(s.p); setTlFeatures(s.f); setTlData(s.d); setTlCommission(s.c);
            setTlSettings(s.s ?? DEFAULT_SETTINGS_SECTIONS.map((row) => ({ ...row })));
          }
          setActiveRole(role);
          setPendingRole(null);
        },
      });
    } else {
      setActiveRole(role);
    }
  };

  const pages = activeRole === "agent" ? agentPages : activeRole === "teamLeader" ? tlPages : defaultPages;
  const setPages = activeRole === "agent" ? setAgentPages : setTlPages;
  const features = activeRole === "agent" ? agentFeatures : activeRole === "teamLeader" ? tlFeatures : defaultFeatures;
  const setFeatures = activeRole === "agent" ? setAgentFeatures : setTlFeatures;
  const dataAccess = activeRole === "agent" ? agentData : activeRole === "teamLeader" ? tlData : defaultDataAccess;
  const setDataAccess = activeRole === "agent" ? setAgentData : setTlData;
  const commission = activeRole === "agent" ? agentCommission : activeRole === "teamLeader" ? tlCommission : defaultCommission;
  const setCommission = activeRole === "agent" ? setAgentCommission : setTlCommission;
  const settingsSections = activeRole === "agent" ? agentSettings : activeRole === "teamLeader" ? tlSettings : DEFAULT_SETTINGS_SECTIONS;
  const setSettingsSections = activeRole === "agent" ? setAgentSettings : setTlSettings;

  const isAdmin = activeRole === "admin";
  const roleLabel = activeRole === "agent" ? "Agent" : activeRole === "teamLeader" ? "Team Leader" : "Admin";

  const actorName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Unknown";

  const handleSave = async () => {
    if (!profile?.organization_id || !user?.id) return;
    setSaving(true);
    const snap = currentSnapshot();
    const dbRole = ROLE_MAP[activeRole];
    const roleKey = activeRole as "agent" | "teamLeader";
    const savedSnap = activeRole === "agent" ? savedAgent : savedTl;
    try {
      const { data: upsertedRow, error } = await supabase
        .from("role_permissions")
        .upsert({
          organization_id: profile.organization_id,
          role: dbRole,
          permissions: JSON.parse(snap),
          updated_at: new Date().toISOString(),
          updated_by: user.id,
        }, { onConflict: "organization_id,role" })
        .select()
        .maybeSingle();

      if (error) throw error;

      const { changed_keys, diff } = buildPermissionDiff(savedSnap, snap, roleKey);
      writeActivityLog(
        profile.organization_id,
        user.id,
        actorName,
        "role_permissions.updated",
        upsertedRow?.id ?? null,
        { role: dbRole, changed_keys, diff }
      );

      if (activeRole === "agent") setSavedAgent(snap);
      else setSavedTl(snap);

      // Invalidate all role permission caches — actor may switch roles or other components may consume other roles' permissions
      queryClient.invalidateQueries({ queryKey: ["rolePermissions"] });
      toast({ title: `${roleLabel} permissions saved.` });
    } catch (err) {
      console.error(err);
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfirmDialog({
      open: true,
      title: `Reset ${roleLabel} Permissions`,
      desc: `Reset ${roleLabel} permissions to defaults? All custom changes will be lost.`,
      onConfirm: async () => {
        const p = defaultPages.map(x => ({ ...x }));
        const f = deepClone(defaultFeatures);
        const d = deepClone(defaultDataAccess);
        const c = deepClone(defaultCommission);
        const s = DEFAULT_SETTINGS_SECTIONS.map((row) => ({ ...row }));
        const defaultPayload = { p, f, d, c, s };
        const defaultSnap = JSON.stringify(defaultPayload);

        if (activeRole === "agent") {
          setAgentPages(p); setAgentFeatures(f); setAgentData(d); setAgentCommission(c); setAgentSettings(s);
        } else {
          setTlPages(p); setTlFeatures(f); setTlData(d); setTlCommission(c); setTlSettings(s);
        }

        const dbRole = ROLE_MAP[activeRole];
        if (profile?.organization_id && user?.id) {
          try {
            const { data: upsertedRow, error } = await supabase
              .from("role_permissions")
              .upsert({
                organization_id: profile.organization_id,
                role: dbRole,
                permissions: defaultPayload,
                updated_at: new Date().toISOString(),
                updated_by: user.id,
              }, { onConflict: "organization_id,role" })
              .select()
              .maybeSingle();

            if (error) throw error;

            writeActivityLog(
              profile.organization_id,
              user.id,
              actorName,
              "role_permissions.reset",
              upsertedRow?.id ?? null,
              { role: dbRole, diff: { reset_to_defaults: true } }
            );
          } catch (err) {
            console.error(err);
            toast({ title: "Reset saved locally but failed to persist", variant: "destructive" });
          }
        }

        if (activeRole === "agent") setSavedAgent(defaultSnap);
        else setSavedTl(defaultSnap);

        // Invalidate all role permission caches — actor may switch roles or other components may consume other roles' permissions
        queryClient.invalidateQueries({ queryKey: ["rolePermissions"] });
        toast({ title: `${roleLabel} permissions reset to defaults.` });
      },
    });
  };

  const togglePage = (idx: number) => {
    const updated = [...pages];
    const key = activeRole as "agent" | "teamLeader";
    updated[idx] = { ...updated[idx], [key]: !updated[idx][key] };
    setPages(updated);
  };

  const toggleFeature = (catIdx: number, featIdx: number) => {
    const updated = deepClone(features);
    const key = activeRole as "agent" | "teamLeader";
    updated[catIdx].features[featIdx][key] = !updated[catIdx].features[featIdx][key];
    setFeatures(updated);
  };

  const updateDataScope = (idx: number, val: DataScope) => {
    const updated = deepClone(dataAccess);
    const key = activeRole as "agent" | "teamLeader";
    updated[idx][key] = val;
    setDataAccess(updated);
  };

  const toggleCommission = (idx: number) => {
    const updated = deepClone(commission);
    const key = activeRole as "agent" | "teamLeader";
    updated[idx][key] = !updated[idx][key];
    setCommission(updated);
  };

  const toggleSettingsSection = (slug: string) => {
    const updated = settingsSections.map((row) => {
      if (row.slug !== slug) return row;
      const key = activeRole as "agent" | "teamLeader";
      return { ...row, [key]: !row[key] };
    });
    setSettingsSections(updated);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading permissions...</p>
      </div>
    );
  }

  const roles: { key: Role; label: string }[] = [
    { key: "agent", label: "Agent" },
    { key: "teamLeader", label: "Team Leader" },
    { key: "admin", label: "Admin" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Permissions</h3>
        <p className="text-sm text-muted-foreground">Manage role-based access controls for your team.</p>
      </div>

      {/* Role tabs */}
      <div className="flex gap-1 rounded-lg p-1 bg-background border">
        {roles.map((r) => (
          <button
            key={r.key}
            onClick={() => switchRole(r.key)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeRole === r.key
                ? "bg-primary text-primary-foreground"
                : "bg-transparent text-muted-foreground"
            }`}
          >
            {r.key === "admin" && <Lock className="w-3.5 h-3.5" />}
            {r.label}
          </button>
        ))}
      </div>

      {/* Info banner */}
      {!isAdmin && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <p className="text-xs text-primary">
            Permission changes apply to active sessions when reloaded. All changes are logged to the Activity Log.
          </p>
        </div>
      )}

      {/* Admin locked banner */}
      {isAdmin && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-card border">
          <Lock className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Admin has full access to everything and cannot be restricted.</p>
            <p className="text-xs mt-1 text-muted-foreground">All permissions below are shown as read-only for reference.</p>
          </div>
        </div>
      )}

      {/* Accordion sections */}
      <div className="space-y-3">
        <AccordionSection title="Page Access" description="Control which pages appear in the sidebar for this role. Settings is always available — use Settings Sections below to control tabs." icon={LayoutGrid}>
          <div className="space-y-1">
            {pages.map((page, idx) => {
              const val = isAdmin ? true : page[activeRole as "agent" | "teamLeader"];
              return (
                <div
                  key={page.name}
                  className={`flex items-center justify-between py-2 px-3 rounded-lg bg-background ${!val && !isAdmin ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-3">
                    <page.icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">{page.name}</span>
                    {!val && !isAdmin && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                        Hidden
                      </span>
                    )}
                  </div>
                  <Switch checked={val} onCheckedChange={() => togglePage(idx)} disabled={isAdmin} />
                </div>
              );
            })}
          </div>
        </AccordionSection>

        <AccordionSection title="Settings Sections" description="Control which Settings tabs this role can see. Applies only within your organization." icon={Lock}>
          <div className="space-y-4">
            {SETTINGS_CONFIG.map((cat) => {
              const catSections = settingsSections.filter((row) =>
                cat.sections.some((s) => s.slug === row.slug)
              );
              if (catSections.length === 0) return null;
              return (
                <div key={cat.label}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 text-primary">
                    {cat.label}
                  </h4>
                  <div className="space-y-1">
                    {catSections.map((row) => {
                      const val = isAdmin ? true : row[activeRole as "agent" | "teamLeader"];
                      return (
                        <div
                          key={row.slug}
                          className={`flex items-center justify-between py-2 px-3 rounded-lg bg-background ${!val && !isAdmin ? "opacity-50" : ""}`}
                        >
                          <span className="text-sm text-foreground">{row.label}</span>
                          <Switch
                            checked={val}
                            onCheckedChange={() => toggleSettingsSection(row.slug)}
                            disabled={isAdmin}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </AccordionSection>

        <AccordionSection title="Feature Permissions" description="Control specific actions available to this role within each section." icon={SlidersHorizontal}>
          <div className="space-y-4">
            {features.map((cat, catIdx) => (
              <div key={cat.category}>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 text-primary">
                  {cat.category}
                </h4>
                <div className="space-y-1">
                  {cat.features.map((feat, featIdx) => {
                    const val = isAdmin ? true : feat[activeRole as "agent" | "teamLeader"];
                    return (
                      <div
                        key={feat.name}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-background"
                      >
                        <div>
                          <p className="text-sm text-foreground">{feat.name}</p>
                          <p className="text-xs text-muted-foreground">{feat.description}</p>
                        </div>
                        <Switch checked={val} onCheckedChange={() => toggleFeature(catIdx, featIdx)} disabled={isAdmin} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </AccordionSection>

        <AccordionSection title="Data Access" description="Control how much data this role can see across the platform." icon={Database}>
          <div className="space-y-4">
            {dataAccess.map((item, idx) => {
              const val: DataScope = isAdmin ? "all" : item[activeRole as "agent" | "teamLeader"];
              return (
                <div key={item.label} className="p-3 rounded-lg bg-background">
                  <p className="text-sm font-medium mb-1 text-foreground">{item.label}</p>
                  <p className="text-xs mb-3 text-muted-foreground">{item.description}</p>
                  <DataScopePills value={val} onChange={(v) => updateDataScope(idx, v)} disabled={isAdmin} />
                </div>
              );
            })}
          </div>
        </AccordionSection>

        <AccordionSection title="Commission Visibility" description="Control what commission and earnings information this role can see." icon={DollarSign}>
          <div className="space-y-1">
            {commission.map((item, idx) => {
              const val = isAdmin ? true : item[activeRole as "agent" | "teamLeader"];
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-background"
                >
                  <div>
                    <p className="text-sm text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <Switch checked={val} onCheckedChange={() => toggleCommission(idx)} disabled={isAdmin} />
                </div>
              );
            })}
          </div>
        </AccordionSection>
      </div>

      {/* Save & Reset */}
      {!isAdmin && (
        <div className="space-y-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty()}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium text-primary-foreground bg-primary transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Permissions
          </button>
          <button
            onClick={handleReset}
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-muted-foreground bg-transparent border transition-colors"
          >
            Reset to Defaults
          </button>
        </div>
      )}

      {/* Confirm dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(o) => !o && setConfirmDialog((p) => ({ ...p, open: false }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => { setConfirmDialog((p) => ({ ...p, open: false })); setPendingRole(null); }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { confirmDialog.onConfirm(); setConfirmDialog((p) => ({ ...p, open: false })); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {confirmDialog.title.includes("Reset") ? "Reset" : "Leave"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Permissions;
