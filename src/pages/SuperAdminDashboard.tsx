import React, { useState, useEffect, useCallback } from "react";
import {
  Building2, Users, PhoneCall, DollarSign, Plus, Search,
  MoreHorizontal, ExternalLink, Loader2, CheckCircle2, ArrowRight,
  ShieldCheck, Fingerprint,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usersSupabaseApi } from "@/lib/supabase-users";

// ---- Types ----
interface Organization {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  created_at: string;
  userCount?: number;
  leadCount?: number;
}

// ---- Health Tile ----
const HealthTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
}> = ({ icon, label, value, subtitle, color }) => (
  <Card className="relative overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm">
    <CardContent className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-3xl font-bold mt-1 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>{icon}</div>
      </div>
    </CardContent>
    <div className={`absolute bottom-0 left-0 right-0 h-1 ${color.replace('bg-', 'bg-')}`} />
  </Card>
);

// ---- Provisioning Wizard ----
const ProvisioningWizard: React.FC<{
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ open, onClose, onSuccess }) => {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    orgName: "",
    orgSlug: "",
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
  });
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  const resetForm = () => {
    setStep(1);
    setForm({ orgName: "", orgSlug: "", adminFirstName: "", adminLastName: "", adminEmail: "" });
    setCreatedOrgId(null);
    setSaving(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreateOrg = async () => {
    if (!form.orgName.trim()) {
      toast({ title: "Organization name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const slug = form.orgSlug.trim() || form.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { data, error } = await supabase
        .from("organizations")
        .insert({ name: form.orgName.trim(), slug })
        .select("id")
        .single();
      if (error) throw error;
      setCreatedOrgId(data.id);
      toast({ title: "Organization created", description: `"${form.orgName}" is ready.` });
      setStep(2);
    } catch (e: any) {
      toast({ title: "Failed to create organization", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleInviteAdmin = async () => {
    if (!form.adminEmail.trim() || !form.adminFirstName.trim()) {
      toast({ title: "Admin name and email are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const link = await usersSupabaseApi.generateInviteLink(
        {
          firstName: form.adminFirstName,
          lastName: form.adminLastName,
          email: form.adminEmail,
          role: "Admin" as any,
        },
        createdOrgId
      );

      await usersSupabaseApi.sendInviteEmail({
        email: form.adminEmail,
        firstName: form.adminFirstName,
        role: "Admin",
        inviteURL: link,
      });

      toast({ title: "Admin invited", description: `Invitation sent to ${form.adminEmail}` });
      setStep(3);
    } catch (e: any) {
      toast({ title: "Failed to invite admin", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provision New Organization</DialogTitle>
          <DialogDescription>
            {step === 1 && "Step 1 of 3 — Create the organization."}
            {step === 2 && "Step 2 of 3 — Invite the first Admin."}
            {step === 3 && "Step 3 of 3 — All done!"}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 my-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                s === step
                  ? "bg-primary text-primary-foreground scale-110"
                  : s < step
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {s < step ? <CheckCircle2 className="w-4 h-4" /> : s}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Organization Name *</Label>
              <Input
                value={form.orgName}
                onChange={(e) => setForm((p) => ({ ...p, orgName: e.target.value }))}
                placeholder="Apex Life Insurance Agency"
                autoFocus
              />
            </div>
            <div>
              <Label>URL Slug (optional)</Label>
              <Input
                value={form.orgSlug}
                onChange={(e) => setForm((p) => ({ ...p, orgSlug: e.target.value }))}
                placeholder="apex-life"
              />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to auto-generate from name.</p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={form.adminFirstName}
                  onChange={(e) => setForm((p) => ({ ...p, adminFirstName: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input
                  value={form.adminLastName}
                  onChange={(e) => setForm((p) => ({ ...p, adminLastName: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Admin Email *</Label>
              <Input
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm((p) => ({ ...p, adminEmail: e.target.value }))}
                placeholder="admin@agency.com"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-6 space-y-3">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <h3 className="text-lg font-semibold">Organization Provisioned!</h3>
            <p className="text-sm text-muted-foreground">
              <strong>{form.orgName}</strong> has been created and an invitation has been sent to{" "}
              <strong>{form.adminEmail}</strong>.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <Button onClick={handleCreateOrg} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Organization
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={handleInviteAdmin} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Send Invitation
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={() => {
                handleClose();
                onSuccess();
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---- Main Dashboard ----
const SuperAdminDashboard: React.FC = () => {
  const { toast } = useToast();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalLeads, setTotalLeads] = useState(0);
  const [activeCalls, setActiveCalls] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all organizations
      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });
      if (orgError) throw orgError;

      // Fetch user counts per org
      const { data: profileData } = await supabase
        .from("profiles")
        .select("organization_id");

      // Fetch lead counts per org
      const { data: leadData } = await supabase
        .from("leads")
        .select("organization_id");

      // Fetch active calls count
      const { data: callData } = await supabase
        .from("calls")
        .select("id")
        .eq("status", "in-progress");

      const userCounts: Record<string, number> = {};
      const leadCounts: Record<string, number> = {};

      (profileData || []).forEach((p: any) => {
        if (p.organization_id) {
          userCounts[p.organization_id] = (userCounts[p.organization_id] || 0) + 1;
        }
      });

      (leadData || []).forEach((l: any) => {
        if (l.organization_id) {
          leadCounts[l.organization_id] = (leadCounts[l.organization_id] || 0) + 1;
        }
      });

      const enriched = (orgData || []).map((org: any) => ({
        ...org,
        userCount: userCounts[org.id] || 0,
        leadCount: leadCounts[org.id] || 0,
      }));

      setOrgs(enriched);
      setTotalUsers(profileData?.length || 0);
      setTotalLeads(leadData?.length || 0);
      setActiveCalls(callData?.length || 0);
    } catch (e: any) {
      toast({ title: "Failed to load data", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleVerifyBadge = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!session) {
        toast({ title: "No active session", variant: "destructive" });
        return;
      }

      // Decode JWT Payload (root claims)
      const token = session.access_token;
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      
      const payload = JSON.parse(jsonPayload);

      console.log("🔒 Security Badge Verified:", payload);

      toast({
        title: "Security Badge Verified",
        description: (
          <div className="mt-2 space-y-1.5 font-mono text-[10px]">
            <div className="flex justify-between border-b pb-1">
              <span>ORG_ID:</span>
              <span className="text-blue-500">{payload.org_id || "MISSING"}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span>ROLE:</span>
              <span className="text-emerald-500 font-bold">{payload.user_role || "MISSING"}</span>
            </div>
            <div className="flex justify-between">
              <span>SUPER_ADMIN:</span>
              <span className={payload.is_super_admin ? "text-amber-500 font-bold" : "text-red-500"}>
                {payload.is_super_admin ? "YES (Security Pass)" : "NO"}
              </span>
            </div>
          </div>
        ) as any,
        duration: 10000,
      });
    } catch (e: any) {
      toast({ title: "Verification Failed", description: e.message, variant: "destructive" });
    }
  };

  const filtered = orgs.filter(
    (o) =>
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      (o.slug || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Super Admin Command Center</h1>
          <p className="text-muted-foreground text-sm">Platform-wide organization management</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={handleVerifyBadge} 
            className="gap-2 border-amber-500/50 text-amber-600 hover:bg-amber-500/5 hover:text-amber-700"
          >
            <ShieldCheck className="w-4 h-4" />
            Verify Security Badge
          </Button>
          <Button onClick={() => setWizardOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Organization
          </Button>
        </div>
      </div>

      {/* Health Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <HealthTile
          icon={<Building2 className="w-5 h-5 text-white" />}
          label="Total Organizations"
          value={orgs.length}
          color="bg-blue-600"
        />
        <HealthTile
          icon={<Users className="w-5 h-5 text-white" />}
          label="Total Users"
          value={totalUsers}
          color="bg-violet-600"
        />
        <HealthTile
          icon={<PhoneCall className="w-5 h-5 text-white" />}
          label="Active Call Legs"
          value={activeCalls}
          subtitle="In-progress calls"
          color="bg-emerald-600"
        />
        <HealthTile
          icon={<DollarSign className="w-5 h-5 text-white" />}
          label="Total Leads"
          value={totalLeads.toLocaleString()}
          color="bg-amber-600"
        />
      </div>

      {/* Organizations Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Organizations</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search organizations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left font-medium text-muted-foreground px-6 py-3">Organization</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Slug</th>
                    <th className="text-center font-medium text-muted-foreground px-4 py-3">Users</th>
                    <th className="text-center font-medium text-muted-foreground px-4 py-3">Leads</th>
                    <th className="text-left font-medium text-muted-foreground px-4 py-3">Created</th>
                    <th className="text-right font-medium text-muted-foreground px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((org) => (
                    <tr key={org.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
                      <td className="px-6 py-4 font-medium">{org.name}</td>
                      <td className="px-4 py-4">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {org.slug || "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-center">{org.userCount}</td>
                      <td className="px-4 py-4 text-center">{org.leadCount}</td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {org.created_at ? new Date(org.created_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2">
                              <ExternalLink className="w-4 h-4" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2">
                              <Users className="w-4 h-4" />
                              Manage Users
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        {search ? "No organizations match your search." : "No organizations yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provisioning Wizard */}
      <ProvisioningWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onSuccess={fetchData} />
    </div>
  );
};

export default SuperAdminDashboard;
