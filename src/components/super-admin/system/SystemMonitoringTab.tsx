import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Database,
  Key,
  Phone,
  MessageSquare,
  HardDrive,
  Clock,
  Mail,
  Server,
  Search,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Wrench,
  Loader2,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ---- Types ----
export type SystemStatusType = "healthy" | "degraded" | "outage" | "maintenance";

export interface SystemStatusItem {
  id: string;
  component_name: string;
  status: SystemStatusType;
  description: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
  updater?: {
    first_name: string | null;
    last_name: string | null;
  } | null;
}

// ---- Constants ----
const STATUS_OPTIONS: { value: SystemStatusType; label: string; color: string; bg: string; dot: string }[] = [
  { value: "healthy", label: "Operational", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-500" },
  { value: "degraded", label: "Degraded", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", dot: "bg-amber-500" },
  { value: "outage", label: "Major Outage", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", dot: "bg-rose-500" },
  { value: "maintenance", label: "Maintenance", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", dot: "bg-blue-500" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "All Systems" },
  { value: "healthy", label: "Operational" },
  { value: "degraded", label: "Degraded" },
  { value: "outage", label: "Outage" },
  { value: "maintenance", label: "Maintenance" },
];

// Return specific icon based on component name
const getComponentIcon = (name: string) => {
  const lowercaseName = name.toLowerCase();
  if (lowercaseName.includes("database") || lowercaseName.includes("postgres")) {
    return <Database className="w-4 h-4 text-blue-500" />;
  }
  if (lowercaseName.includes("auth") || lowercaseName.includes("key") || lowercaseName.includes("login")) {
    return <Key className="w-4 h-4 text-amber-500" />;
  }
  if (lowercaseName.includes("twilio") || lowercaseName.includes("voice") || lowercaseName.includes("call")) {
    return <Phone className="w-4 h-4 text-rose-500" />;
  }
  if (lowercaseName.includes("telnyx") || lowercaseName.includes("sms") || lowercaseName.includes("message")) {
    return <MessageSquare className="w-4 h-4 text-emerald-500" />;
  }
  if (lowercaseName.includes("storage") || lowercaseName.includes("bucket") || lowercaseName.includes("s3")) {
    return <HardDrive className="w-4 h-4 text-violet-500" />;
  }
  if (lowercaseName.includes("cron") || lowercaseName.includes("worker") || lowercaseName.includes("background")) {
    return <Clock className="w-4 h-4 text-indigo-500" />;
  }
  if (lowercaseName.includes("email") || lowercaseName.includes("sendgrid") || lowercaseName.includes("mail")) {
    return <Mail className="w-4 h-4 text-cyan-500" />;
  }
  return <Server className="w-4 h-4 text-muted-foreground" />;
};

const getStatusBadgeIcon = (status: SystemStatusType) => {
  switch (status) {
    case "healthy":
      return <CheckCircle2 className="w-3.5 h-3.5 mr-1" />;
    case "degraded":
      return <AlertTriangle className="w-3.5 h-3.5 mr-1" />;
    case "outage":
      return <XCircle className="w-3.5 h-3.5 mr-1" />;
    case "maintenance":
      return <Wrench className="w-3.5 h-3.5 mr-1" />;
  }
};

const SystemMonitoringTab: React.FC = () => {
  const { toast } = useToast();
  const { profile } = useAuth();
  
  // State
  const [items, setItems] = useState<SystemStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [newComponent, setNewComponent] = useState({
    name: "",
    status: "healthy" as SystemStatusType,
    description: "",
    notes: "",
  });
  
  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SystemStatusItem | null>(null);
  
  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingItem, setDeletingItem] = useState<SystemStatusItem | null>(null);
  
  // Saving states
  const [saving, setSaving] = useState(false);

  // Fetch all items from DB
  const fetchStatusItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("system_status" as any)
        .select(`
          *,
          updater:profiles!updated_by (first_name, last_name)
        `)
        .order("component_name");

      if (error) throw error;
      setItems((data as any[]) || []);
    } catch (err: any) {
      toast({
        title: "Failed to load system statuses",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStatusItems();
  }, [fetchStatusItems]);

  // Update status directly in row
  const handleQuickStatusChange = async (itemId: string, newStatus: SystemStatusType) => {
    try {
      const { error } = await supabase
        .from("system_status" as any)
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id || null,
        })
        .eq("id", itemId);

      if (error) throw error;
      
      toast({
        title: "Status updated",
        description: "The system component status was updated successfully.",
      });
      fetchStatusItems();
    } catch (err: any) {
      toast({
        title: "Failed to update status",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // Create new component
  const handleAddComponent = async () => {
    if (!newComponent.name.trim()) {
      toast({
        title: "Name is required",
        variant: "destructive",
      });
      return;
    }
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from("system_status" as any)
        .insert({
          component_name: newComponent.name.trim(),
          status: newComponent.status,
          description: newComponent.description.trim() || null,
          notes: newComponent.notes.trim() || null,
          updated_by: profile?.id || null,
        });

      if (error) throw error;

      toast({
        title: "Component registered",
        description: `"${newComponent.name}" is now being monitored.`,
      });
      setAddOpen(false);
      setNewComponent({ name: "", status: "healthy", description: "", notes: "" });
      fetchStatusItems();
    } catch (err: any) {
      toast({
        title: "Failed to add component",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Save edits
  const handleSaveEdit = async () => {
    if (!editingItem || !editingItem.component_name.trim()) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from("system_status" as any)
        .update({
          component_name: editingItem.component_name.trim(),
          status: editingItem.status,
          description: editingItem.description?.trim() || null,
          notes: editingItem.notes?.trim() || null,
          updated_at: new Date().toISOString(),
          updated_by: profile?.id || null,
        })
        .eq("id", editingItem.id);

      if (error) throw error;

      toast({
        title: "Component updated",
        description: `"${editingItem.component_name}" updates saved.`,
      });
      setEditOpen(false);
      setEditingItem(null);
      fetchStatusItems();
    } catch (err: any) {
      toast({
        title: "Failed to update component",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Delete component
  const handleDeleteComponent = async () => {
    if (!deletingItem) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from("system_status" as any)
        .delete()
        .eq("id", deletingItem.id);

      if (error) throw error;

      toast({
        title: "Component deleted",
        description: `"${deletingItem.component_name}" has been removed.`,
      });
      setDeleteOpen(false);
      setDeletingItem(null);
      fetchStatusItems();
    } catch (err: any) {
      toast({
        title: "Failed to delete component",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Compute stats
  const totalCount = items.length;
  const outageCount = items.filter((item) => item.status === "outage").length;
  const degradedCount = items.filter((item) => item.status === "degraded").length;
  const maintenanceCount = items.filter((item) => item.status === "maintenance").length;

  let overallStatus: "healthy" | "degraded" | "outage" | "maintenance" = "healthy";
  if (outageCount > 0) overallStatus = "outage";
  else if (degradedCount > 0) overallStatus = "degraded";
  else if (maintenanceCount > 0) overallStatus = "maintenance";

  const overallCardStyle = {
    healthy: {
      bg: "bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20",
      title: "All Systems Operational",
      desc: "All platform components and integrations are running normally.",
      badgeColor: "bg-emerald-500 text-white",
      pulse: "bg-emerald-400",
    },
    degraded: {
      bg: "bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/20",
      title: "Degraded Performance",
      desc: "One or more services are experiencing performance issues.",
      badgeColor: "bg-amber-500 text-white",
      pulse: "bg-amber-400",
    },
    outage: {
      bg: "bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/20",
      title: "Major Outage",
      desc: "Platform outages detected. Engineering is actively investigating.",
      badgeColor: "bg-rose-500 text-white",
      pulse: "bg-rose-400",
    },
    maintenance: {
      bg: "bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border-blue-500/20",
      title: "Scheduled Maintenance",
      desc: "Some components are currently undergoing routine maintenance.",
      badgeColor: "bg-blue-500 text-white",
      pulse: "bg-blue-400",
    },
  }[overallStatus];

  // Filtering
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.component_name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description || "").toLowerCase().includes(search.toLowerCase()) ||
      (item.notes || "").toLowerCase().includes(search.toLowerCase());
      
    const matchesFilter = statusFilter === "all" || item.status === statusFilter;
    
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      {/* Overall Health Card */}
      <Card className={`relative overflow-hidden border backdrop-blur-sm transition-all duration-300 ${overallCardStyle.bg}`}>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-card border shadow-sm">
                <Activity className="h-6 w-6 text-foreground" />
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${overallCardStyle.pulse}`} />
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${overallCardStyle.pulse.replace('400', '500')}`} />
                </span>
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight">{overallCardStyle.title}</h2>
                <p className="text-muted-foreground text-sm">{overallCardStyle.desc}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 mt-2 sm:mt-0">
              <Badge className={`${overallCardStyle.badgeColor} px-3 py-1 text-xs font-semibold capitalize tracking-wide shadow-sm`}>
                {overallStatus === "healthy" ? "Operational" : overallStatus}
              </Badge>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8 hover:bg-muted"
                onClick={fetchStatusItems}
                disabled={loading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Control Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search & Tabs */}
        <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search components..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all duration-200 ${
                  statusFilter === f.value
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-muted/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Create Action */}
        <Button onClick={() => setAddOpen(true)} className="gap-2 h-9">
          <Plus className="w-4 h-4" />
          Add Component
        </Button>
      </div>

      {/* Main Table Card */}
      <Card className="border border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3 border-b border-border/30">
          <CardTitle className="text-base font-semibold">Service Status Ledger</CardTitle>
          <CardDescription>
            Live registry of cloud infrastructure, integrations, and daemon performance.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Retrieving ledger statuses...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/20 text-muted-foreground font-medium">
                    <th className="text-left px-6 py-3.5">Component</th>
                    <th className="text-left px-4 py-3.5">Status</th>
                    <th className="text-left px-4 py-3.5">Description</th>
                    <th className="text-left px-4 py-3.5">Notes</th>
                    <th className="text-left px-4 py-3.5">Last Updated</th>
                    <th className="text-right px-6 py-3.5">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const opt = STATUS_OPTIONS.find((s) => s.value === item.status) || STATUS_OPTIONS[0];
                    return (
                      <tr 
                        key={item.id} 
                        className="border-b last:border-b-0 hover:bg-muted/15 transition-colors group"
                      >
                        {/* Name & Icon */}
                        <td className="px-6 py-4.5">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-muted/80 border border-border/50 shadow-sm flex items-center justify-center">
                              {getComponentIcon(item.component_name)}
                            </div>
                            <span className="font-semibold text-foreground tracking-tight">
                              {item.component_name}
                            </span>
                          </div>
                        </td>

                        {/* Status dropdown badge */}
                        <td className="px-4 py-4.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button 
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border shadow-sm transition-all hover:scale-105 active:scale-95 cursor-pointer select-none ${opt.bg} ${opt.color}`}
                              >
                                <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${opt.dot} ${item.status === 'outage' ? 'animate-ping' : ''}`} />
                                {getStatusBadgeIcon(item.status)}
                                {opt.label}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-40">
                              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground tracking-wide uppercase border-b mb-1">
                                Change Status
                              </div>
                              {STATUS_OPTIONS.map((statusOpt) => (
                                <DropdownMenuItem
                                  key={statusOpt.value}
                                  onClick={() => handleQuickStatusChange(item.id, statusOpt.value)}
                                  className="flex items-center gap-2 cursor-pointer text-xs"
                                >
                                  <span className={`h-2 w-2 rounded-full ${statusOpt.dot}`} />
                                  {statusOpt.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>

                        {/* Description */}
                        <td className="px-4 py-4.5 max-w-xs text-muted-foreground leading-relaxed">
                          {item.description || <span className="italic text-muted-foreground/50">No description</span>}
                        </td>

                        {/* Notes */}
                        <td className="px-4 py-4.5 max-w-sm text-foreground/80 font-mono text-xs">
                          {item.notes ? (
                            <div className="bg-muted/50 border border-border/40 rounded-lg p-2 max-h-20 overflow-y-auto">
                              {item.notes}
                            </div>
                          ) : (
                            <span className="italic text-muted-foreground/45">—</span>
                          )}
                        </td>

                        {/* Last Updated Audit */}
                        <td className="px-4 py-4.5 text-xs text-muted-foreground">
                          <div className="flex flex-col gap-0.5">
                            <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                            <span className="opacity-70">{new Date(item.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {item.updater && (
                              <span className="text-[10px] font-medium text-primary mt-0.5 flex items-center gap-0.5">
                                <User className="w-2.5 h-2.5" />
                                {item.updater.first_name || item.updater.last_name 
                                  ? `${item.updater.first_name || ''} ${item.updater.last_name || ''}`.trim()
                                  : "Operator"
                                }
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 hover:bg-muted"
                              onClick={() => {
                                setEditingItem({ ...item });
                                setEditOpen(true);
                              }}
                            >
                              <Edit2 className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 hover:bg-rose-500/10 group-hover:block"
                              onClick={() => {
                                setDeletingItem(item);
                                setDeleteOpen(true);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  
                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-16 text-muted-foreground">
                        {search || statusFilter !== "all" 
                          ? "No services matching query filters." 
                          : "No components tracked in monitoring ledger."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register Monitored Service</DialogTitle>
            <DialogDescription>
              Register a new cloud component or system API to track health in the ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Service Name *</label>
              <Input
                placeholder="e.g. Redis Cache cluster"
                value={newComponent.name}
                onChange={(e) => setNewComponent(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Initial Status</label>
              <Select
                value={newComponent.status}
                onValueChange={(val: SystemStatusType) => setNewComponent(prev => ({ ...prev, status: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Service Description</label>
              <Input
                placeholder="Brief summary of service utility..."
                value={newComponent.description}
                onChange={(e) => setNewComponent(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Operational Notes</label>
              <Textarea
                placeholder="Enter current diagnostic notes or deployment details..."
                value={newComponent.notes}
                onChange={(e) => setNewComponent(prev => ({ ...prev, notes: e.target.value }))}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleAddComponent} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Register Service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => {
        if (!open) setEditingItem(null);
        setEditOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Service Details</DialogTitle>
            <DialogDescription>
              Update operational parameters and logs for this component.
            </DialogDescription>
          </DialogHeader>
          {editingItem && (
            <div className="space-y-4 py-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Service Name *</label>
                <Input
                  placeholder="e.g. Database Cluster"
                  value={editingItem.component_name}
                  onChange={(e) => setEditingItem(prev => prev ? { ...prev, component_name: e.target.value } : null)}
                />
              </div>
              
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Health Status</label>
                <Select
                  value={editingItem.status}
                  onValueChange={(val: SystemStatusType) => setEditingItem(prev => prev ? { ...prev, status: val } : null)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Service Description</label>
                <Input
                  placeholder="Enter service details..."
                  value={editingItem.description || ""}
                  onChange={(e) => setEditingItem(prev => prev ? { ...prev, description: e.target.value } : null)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Diagnostic Notes</label>
                <Textarea
                  placeholder="Enter diagnostic logs, CPU status, or action items..."
                  value={editingItem.notes || ""}
                  onChange={(e) => setEditingItem(prev => prev ? { ...prev, notes: e.target.value } : null)}
                  className="min-h-[100px]"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={(open) => {
        if (!open) setDeletingItem(null);
        setDeleteOpen(open);
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-rose-600">Delete Component Monitoring?</DialogTitle>
            <DialogDescription>
              Are you sure you want to stop tracking **{deletingItem?.component_name}**? This action deletes its historical diagnostic notes from the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteComponent} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete Component
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SystemMonitoringTab;
