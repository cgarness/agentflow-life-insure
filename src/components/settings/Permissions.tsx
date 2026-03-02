import React, { useState, useCallback } from "react";
import {
  Lock, LayoutGrid, SlidersHorizontal, Database, DollarSign,
  ChevronDown, Info, BarChart3, Phone, Users, MessageSquare,
  Calendar, Megaphone, Trophy, FileText, Bot, GraduationCap,
  Calculator, MessagesSquare, Settings,
} from "lucide-react";
import { toast } from "sonner";
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
  { name: "Quote Builder", icon: Calculator, agent: true, teamLeader: true },
  { name: "Team Chat", icon: MessagesSquare, agent: true, teamLeader: true },
  { name: "Settings", icon: Settings, agent: false, teamLeader: false },
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

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${checked ? "bg-primary" : "bg-muted"}`}
  >
    <span
      className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200"
      style={{ transform: checked ? "translateX(18px)" : "translateX(3px)" }}
    />
  </button>
);

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

const Permissions: React.FC = () => {
  const [activeRole, setActiveRole] = useState<Role>("agent");
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; desc: string; onConfirm: () => void }>({ open: false, title: "", desc: "", onConfirm: () => {} });
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  // State per role
  const [agentPages, setAgentPages] = useState(() => defaultPages.map((p) => ({ ...p })));
  const [tlPages, setTlPages] = useState(() => defaultPages.map((p) => ({ ...p })));

  const [agentFeatures, setAgentFeatures] = useState(() => deepClone(defaultFeatures));
  const [tlFeatures, setTlFeatures] = useState(() => deepClone(defaultFeatures));

  const [agentData, setAgentData] = useState(() => deepClone(defaultDataAccess));
  const [tlData, setTlData] = useState(() => deepClone(defaultDataAccess));

  const [agentCommission, setAgentCommission] = useState(() => deepClone(defaultCommission));
  const [tlCommission, setTlCommission] = useState(() => deepClone(defaultCommission));

  // Saved snapshots to track dirty state
  const [savedAgent, setSavedAgent] = useState(() => JSON.stringify({ p: defaultPages, f: defaultFeatures, d: defaultDataAccess, c: defaultCommission }));
  const [savedTl, setSavedTl] = useState(() => JSON.stringify({ p: defaultPages.map(p => ({ ...p })), f: deepClone(defaultFeatures), d: deepClone(defaultDataAccess), c: deepClone(defaultCommission) }));

  const currentSnapshot = useCallback(() => {
    if (activeRole === "agent") return JSON.stringify({ p: agentPages, f: agentFeatures, d: agentData, c: agentCommission });
    if (activeRole === "teamLeader") return JSON.stringify({ p: tlPages, f: tlFeatures, d: tlData, c: tlCommission });
    return "";
  }, [activeRole, agentPages, agentFeatures, agentData, agentCommission, tlPages, tlFeatures, tlData, tlCommission]);

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
          } else {
            const s = JSON.parse(savedTl);
            setTlPages(s.p); setTlFeatures(s.f); setTlData(s.d); setTlCommission(s.c);
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

  const isAdmin = activeRole === "admin";
  const roleLabel = activeRole === "agent" ? "Agent" : activeRole === "teamLeader" ? "Team Leader" : "Admin";

  const handleSave = () => {
    const snap = currentSnapshot();
    if (activeRole === "agent") setSavedAgent(snap);
    else setSavedTl(snap);
    toast.success(`${roleLabel} permissions saved.`);
  };

  const handleReset = () => {
    setConfirmDialog({
      open: true,
      title: `Reset ${roleLabel} Permissions`,
      desc: `Reset ${roleLabel} permissions to defaults? All custom changes will be lost.`,
      onConfirm: () => {
        if (activeRole === "agent") {
          const p = defaultPages.map(x => ({ ...x }));
          const f = deepClone(defaultFeatures);
          const d = deepClone(defaultDataAccess);
          const c = deepClone(defaultCommission);
          setAgentPages(p); setAgentFeatures(f); setAgentData(d); setAgentCommission(c);
          setSavedAgent(JSON.stringify({ p, f, d, c }));
        } else {
          const p = defaultPages.map(x => ({ ...x }));
          const f = deepClone(defaultFeatures);
          const d = deepClone(defaultDataAccess);
          const c = deepClone(defaultCommission);
          setTlPages(p); setTlFeatures(f); setTlData(d); setTlCommission(c);
          setSavedTl(JSON.stringify({ p, f, d, c }));
        }
        toast.success(`${roleLabel} permissions reset to defaults.`);
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
            Permission changes apply to active sessions within 60 seconds. All changes are logged to the Activity Log.
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
        {/* Section 1 — Page Access */}
        <AccordionSection title="Page Access" description="Control which pages appear in the sidebar for this role." icon={LayoutGrid}>
          <div className="space-y-1">
            {pages.map((page, idx) => {
              const val = isAdmin ? true : (page as any)[activeRole];
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
                  <Toggle checked={val} onChange={() => togglePage(idx)} disabled={isAdmin} />
                </div>
              );
            })}
          </div>
          <div className="flex items-start gap-2 mt-3">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Settings is always hidden for Agents and Team Leaders by default. Admins always have full access.
            </p>
          </div>
        </AccordionSection>

        {/* Section 2 — Feature Permissions */}
        <AccordionSection title="Feature Permissions" description="Control specific actions available to this role within each section." icon={SlidersHorizontal}>
          <div className="space-y-4">
            {features.map((cat, catIdx) => (
              <div key={cat.category}>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-2 text-primary">
                  {cat.category}
                </h4>
                <div className="space-y-1">
                  {cat.features.map((feat, featIdx) => {
                    const val = isAdmin ? true : (feat as any)[activeRole];
                    return (
                      <div
                        key={feat.name}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-background"
                      >
                        <div>
                          <p className="text-sm text-foreground">{feat.name}</p>
                          <p className="text-xs text-muted-foreground">{feat.description}</p>
                        </div>
                        <Toggle checked={val} onChange={() => toggleFeature(catIdx, featIdx)} disabled={isAdmin} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </AccordionSection>

        {/* Section 3 — Data Access */}
        <AccordionSection title="Data Access" description="Control how much data this role can see across the platform." icon={Database}>
          <div className="space-y-4">
            {dataAccess.map((item, idx) => {
              const val = isAdmin ? "all" as DataScope : (item as any)[activeRole] as DataScope;
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

        {/* Section 4 — Commission Visibility */}
        <AccordionSection title="Commission Visibility" description="Control what commission and earnings information this role can see." icon={DollarSign}>
          <div className="space-y-1">
            {commission.map((item, idx) => {
              const val = isAdmin ? true : (item as any)[activeRole];
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-background"
                >
                  <div>
                    <p className="text-sm text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <Toggle checked={val} onChange={() => toggleCommission(idx)} disabled={isAdmin} />
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
            className="w-full py-2.5 rounded-lg text-sm font-medium text-primary-foreground bg-primary transition-colors"
          >
            Save Permissions
          </button>
          <button
            onClick={handleReset}
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
