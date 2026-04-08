import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Building2, Users, PhoneCall, DollarSign, Plus, Search,
  ArrowLeft, Loader2, Mail, Shield, Calendar, Target,
  TrendingUp, Activity, Briefcase, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

// ---- Types ----
interface Organization {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
}

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

interface OrgStats {
  totalUsers: number;
  totalLeads: number;
  totalClients: number;
  totalCampaigns: number;
  totalCalls: number;
  totalAppointments: number;
}

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description?: string;
  color: string;
}> = ({ icon, label, value, description, color }) => (
  <Card className="relative overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm transition-all hover:shadow-md">
    <CardContent className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-3xl font-bold tracking-tight">{value}</p>
          </div>
          {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color} bg-opacity-10 text-current`}>{icon}</div>
      </div>
    </CardContent>
    <div className={`absolute bottom-0 left-0 right-0 h-1 ${color} opacity-50`} />
  </Card>
);

const SuperAdminOrgDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [org, setOrg] = useState<Organization | null>(null);
  const [stats, setStats] = useState<OrgStats>({
    totalUsers: 0,
    totalLeads: 0,
    totalClients: 0,
    totalCampaigns: 0,
    totalCalls: 0,
    totalAppointments: 0,
  });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // 1. Fetch Org Basic Info
      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", id)
        .single();
      if (orgError) throw orgError;
      setOrg(orgData);

      // 2. Fetch Aggregates in Parallel
      const [
        usersRes,
        leadsRes,
        clientsRes,
        campaignsRes,
        callsRes,
        appointmentsRes,
        profilesRes
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("organization_id", id),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("organization_id", id),
        supabase.from("clients").select("*", { count: "exact", head: true }).eq("organization_id", id),
        supabase.from("campaigns").select("*", { count: "exact", head: true }).eq("organization_id", id),
        supabase.from("calls").select("*", { count: "exact", head: true }).eq("organization_id", id),
        supabase.from("appointments").select("*", { count: "exact", head: true }).eq("organization_id", id),
        supabase.from("profiles").select("*").eq("organization_id", id).order("created_at", { ascending: false })
      ]);

      setStats({
        totalUsers: usersRes.count || 0,
        totalLeads: leadsRes.count || 0,
        totalClients: clientsRes.count || 0,
        totalCampaigns: campaignsRes.count || 0,
        totalCalls: callsRes.count || 0,
        totalAppointments: appointmentsRes.count || 0,
      });

      setProfiles(profilesRes.data || []);
    } catch (e: any) {
      toast({ title: "Failed to load organization", description: e.message, variant: "destructive" });
      navigate("/super-admin");
    } finally {
      setLoading(false);
    }
  }, [id, toast, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredProfiles = profiles.filter(p => 
    (p.first_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (p.last_name || "").toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading && !org) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-muted-foreground animate-pulse">Loading organization details...</p>
      </div>
    );
  }

  if (!org) return null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate("/super-admin")}
            className="rounded-full hover:bg-primary/10 hover:text-primary transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{org.name}</h1>
              <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-mono text-xs uppercase tracking-tighter">
                {org.slug || "NO-SLUG"}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
              <Shield className="w-3.5 h-3.5" />
              Created on {new Date(org.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={fetchData}>
            <Activity className="w-4 h-4" />
            Refresh Data
          </Button>
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            Add User
          </Button>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard 
          icon={<Users className="w-5 h-5 text-blue-500" />}
          label="Team Size"
          value={stats.totalUsers}
          color="bg-blue-500"
        />
        <StatCard 
          icon={<Target className="w-5 h-5 text-violet-500" />}
          label="Leads"
          value={stats.totalLeads.toLocaleString()}
          color="bg-violet-500"
        />
        <StatCard 
          icon={<DollarSign className="w-5 h-5 text-emerald-500" />}
          label="Clients"
          value={stats.totalClients.toLocaleString()}
          color="bg-emerald-500"
        />
        <StatCard 
          icon={<Briefcase className="w-5 h-5 text-amber-500" />}
          label="Campaigns"
          value={stats.totalCampaigns}
          color="bg-amber-500"
        />
        <StatCard 
          icon={<PhoneCall className="w-5 h-5 text-rose-500" />}
          label="Calls"
          value={stats.totalCalls.toLocaleString()}
          color="bg-rose-500"
        />
        <StatCard 
          icon={<Calendar className="w-5 h-5 text-sky-500" />}
          label="Appointments"
          value={stats.totalAppointments}
          color="bg-sky-500"
        />
      </div>

      <Tabs defaultValue="users" className="space-y-6">
        <div className="flex items-center justify-between border-b pb-1">
          <TabsList className="bg-transparent border-none">
            <TabsTrigger 
              value="users" 
              className="px-6 py-2.5 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent transition-none"
            >
              Users & Team
            </TabsTrigger>
            <TabsTrigger 
              value="activity" 
              className="px-6 py-2.5 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent transition-none"
            >
              Performance
            </TabsTrigger>
            <TabsTrigger 
              value="settings" 
              className="px-6 py-2.5 rounded-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent transition-none"
            >
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="users" className="space-y-4 animate-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6 bg-muted/5">
              <div>
                <CardTitle>Organization Users</CardTitle>
                <CardDescription>Manage team members and their platform permissions</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 bg-background/50"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left font-medium text-muted-foreground px-6 py-3">Member</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">Email</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">Role</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">Status</th>
                      <th className="text-left font-medium text-muted-foreground px-4 py-3">Joined</th>
                      <th className="text-right font-medium text-muted-foreground px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProfiles.map((profile) => (
                      <tr key={profile.id} className="border-b last:border-b-0 hover:bg-muted/10 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                              {(profile.first_name?.[0] || profile.email[0]).toUpperCase()}
                            </div>
                            <span className="font-semibold text-foreground">
                              {profile.first_name} {profile.last_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 opacity-60" />
                            {profile.email}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant="outline" className={`
                            ${profile.role === 'Admin' ? 'border-amber-500/50 text-amber-600 bg-amber-500/5' : 'border-blue-500/50 text-blue-600 bg-blue-500/5'}
                            font-medium text-[10px] uppercase tracking-wide
                          `}>
                            {profile.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${profile.status === 'Active' ? 'bg-green-500' : 'bg-red-400'}`} />
                            <span className="text-xs">{profile.status}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground text-xs">
                          {new Date(profile.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filteredProfiles.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted-foreground">
                          {search ? "No users match your criteria." : "No users found in this organization."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="animate-in slide-in-from-bottom-2 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Performance Overview
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64 flex items-center justify-center bg-muted/10 rounded-b-xl border-t border-border/50">
                <div className="text-center space-y-2">
                  <Activity className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground italic">Performance visualization coming soon</p>
                </div>
              </CardContent>
            </Card>
            
            <Card className="border-border/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  Recent Campaigns
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64 flex items-center justify-center bg-muted/10 rounded-b-xl border-t border-border/50">
                <div className="text-center space-y-2">
                  <Target className="w-12 h-12 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground italic">Campaign history coming soon</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="animate-in slide-in-from-bottom-2 duration-300">
          <Card className="border-border/50 bg-muted/5">
            <CardContent className="py-12 flex flex-col items-center justify-center text-center">
              <Building2 className="w-12 h-12 text-muted-foreground/20 mb-4" />
              <h3 className="text-lg font-medium">Tenant Configuration</h3>
              <p className="text-sm text-muted-foreground max-w-xs mt-1">
                Administrative settings and tenant-level limits for {org.name}
              </p>
              <Button variant="outline" className="mt-6 border-dashed">
                Configure Organization
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SuperAdminOrgDetail;
