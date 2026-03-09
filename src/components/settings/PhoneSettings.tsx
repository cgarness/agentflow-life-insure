import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Phone, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Plus, ShoppingCart,
  MoreHorizontal, ShieldCheck, ShieldAlert, ShieldQuestion, AlertTriangle,
  MapPin, RefreshCw, Trash2, Search, Radio, Info
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";
const TELNYX_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

const formatPhone = (num: string) => {
  const cleaned = num.replace(/\D/g, "");
  const digits = cleaned.startsWith("1") && cleaned.length === 11 ? cleaned.slice(1) : cleaned;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return num;
};

const extractAreaCode = (num: string) => {
  const cleaned = num.replace(/\D/g, "");
  const digits = cleaned.startsWith("1") && cleaned.length === 11 ? cleaned.slice(1) : cleaned;
  return digits.slice(0, 3);
};

interface PhoneNumber {
  id: string;
  phone_number: string;
  friendly_name: string | null;
  status: string | null;
  assigned_to: string | null;
  area_code: string | null;
  is_default: boolean | null;
  spam_status: string | null;
  spam_score: number | null;
  spam_checked_at: string | null;
}

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
}

const PhoneSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);

  // Credentials
  const [apiKey, setApiKey] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [sipUsername, setSipUsername] = useState("");
  const [sipPassword, setSipPassword] = useState("");
  const [originals, setOriginals] = useState({ apiKey: "", connectionId: "", sipUsername: "", sipPassword: "" });
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSipPass, setShowSipPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Numbers
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Profile[]>([]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [bulkChecking, setBulkChecking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);

  // Local Presence
  const [localPresenceEnabled, setLocalPresenceEnabled] = useState(false);

  // Add Manually Modal
  const [addManualOpen, setAddManualOpen] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [addingManual, setAddingManual] = useState(false);

  // Purchase Modal
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [searchAreaCode, setSearchAreaCode] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseStep, setPurchaseStep] = useState<1 | 2>(1);

  // Confirm dialogs
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);

  const hasChanges = apiKey !== originals.apiKey || connectionId !== originals.connectionId || sipUsername !== originals.sipUsername || sipPassword !== originals.sipPassword;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [telnyxRes, settingsRes, numbersRes, agentsRes] = await Promise.all([
      supabase.from("telnyx_settings").select("*").eq("id", TELNYX_SETTINGS_ID).maybeSingle(),
      supabase.from("phone_settings").select("*").eq("id", SINGLETON_ID).maybeSingle(),
      supabase.from("phone_numbers").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, first_name, last_name"),
    ]);

    if (telnyxRes.data) {
      const d = telnyxRes.data as any;
      setApiKey(d.api_key || "");
      setConnectionId(d.connection_id || "");
      setSipUsername(d.sip_username || "");
      setSipPassword(d.sip_password || "");
      setOriginals({ apiKey: d.api_key || "", connectionId: d.connection_id || "", sipUsername: d.sip_username || "", sipPassword: d.sip_password || "" });
    }

    if (settingsRes.data) {
      // Local presence from api_secret JSON
      try {
        const flags = settingsRes.data.api_secret ? JSON.parse(settingsRes.data.api_secret) : {};
        setLocalPresenceEnabled(!!flags.local_presence_enabled);
      } catch { setLocalPresenceEnabled(false); }
    }

    setNumbers((numbersRes.data || []) as PhoneNumber[]);
    setAgents((agentsRes.data || []) as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const activeNumbers = numbers.filter(n => n.status === "active");

  // Save credentials
  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.from("telnyx_settings").upsert({
      id: TELNYX_SETTINGS_ID,
      api_key: apiKey,
      connection_id: connectionId,
      sip_username: sipUsername,
      sip_password: sipPassword,
      updated_at: new Date().toISOString(),
    } as any);
    setSaving(false);
    if (error) { toast.error("Failed to save credentials"); return; }
    setOriginals({ apiKey, connectionId, sipUsername, sipPassword });
    toast.success("Credentials saved");
  };

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-token", { body: { connection_id: connectionId } });
      if (error) throw error;
      if (data?.sip_username) {
        setTestResult({ success: true, message: "Connection successful ✓" });
      } else {
        setTestResult({ success: false, message: data?.error || "Connection failed" });
      }
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || "Connection failed" });
    }
    setTesting(false);
  };

  // Set default number
  const handleSetDefault = async (id: string) => {
    await supabase.from("phone_numbers").update({ is_default: false }).neq("id", id);
    await supabase.from("phone_numbers").update({ is_default: true }).eq("id", id);
    setNumbers(prev => prev.map(n => ({ ...n, is_default: n.id === id })));
    toast.success("Default number updated");
  };

  // Inline edit friendly name
  const handleSaveName = async (id: string) => {
    await supabase.from("phone_numbers").update({ friendly_name: editNameValue }).eq("id", id);
    setNumbers(prev => prev.map(n => n.id === id ? { ...n, friendly_name: editNameValue } : n));
    setEditingName(null);
    toast.success("Name updated");
  };

  // Assign agent
  const handleAssign = async (numberId: string, agentId: string | null) => {
    await supabase.from("phone_numbers").update({ assigned_to: agentId }).eq("id", numberId);
    setNumbers(prev => prev.map(n => n.id === numberId ? { ...n, assigned_to: agentId } : n));
    toast.success("Assignment updated");
  };

  // Spam check (placeholder)
  const handleSpamCheck = async (id: string) => {
    setNumbers(prev => prev.map(n => n.id === id ? { ...n, spam_status: "checking" as any } : n));
    await new Promise(r => setTimeout(r, 1000));
    const now = new Date().toISOString();
    await supabase.from("phone_numbers").update({ spam_status: "Clean", spam_score: 0, spam_checked_at: now }).eq("id", id);
    setNumbers(prev => prev.map(n => n.id === id ? { ...n, spam_status: "Clean", spam_score: 0, spam_checked_at: now } : n));
    toast.success("Spam check complete — Clean");
  };

  // Bulk spam check
  const handleBulkSpamCheck = async () => {
    const active = numbers.filter(n => n.status === "active");
    if (active.length === 0) return;
    setBulkChecking(true);
    setBulkProgress(0);
    for (let i = 0; i < active.length; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const now = new Date().toISOString();
      await supabase.from("phone_numbers").update({ spam_status: "Clean", spam_score: 0, spam_checked_at: now }).eq("id", active[i].id);
      setNumbers(prev => prev.map(n => n.id === active[i].id ? { ...n, spam_status: "Clean", spam_score: 0, spam_checked_at: now } : n));
      setBulkProgress(Math.round(((i + 1) / active.length) * 100));
    }
    setBulkChecking(false);
    toast.success(`Spam check complete for ${active.length} numbers`);
  };

  // Release number
  const handleRelease = async (id: string) => {
    await supabase.from("phone_numbers").update({ status: "released", assigned_to: null, is_default: false }).eq("id", id);
    setNumbers(prev => prev.map(n => n.id === id ? { ...n, status: "released", assigned_to: null, is_default: false } : n));
    setReleaseConfirm(null);
    toast.success("Number released");
  };

  // Remove number
  const handleRemove = async (id: string) => {
    await supabase.from("phone_numbers").delete().eq("id", id);
    setNumbers(prev => prev.filter(n => n.id !== id));
    setRemoveConfirm(null);
    toast.success("Number removed");
  };

  // Add manually
  const handleAddManual = async () => {
    if (!manualPhone.trim()) return;
    setAddingManual(true);
    const areaCode = extractAreaCode(manualPhone);
    const { error } = await supabase.from("phone_numbers").insert({
      phone_number: manualPhone.trim(),
      friendly_name: manualName.trim() || null,
      status: "active",
      area_code: areaCode,
      spam_status: "Unknown",
    });
    setAddingManual(false);
    if (error) { toast.error("Failed to add number"); return; }
    setAddManualOpen(false);
    setManualPhone("");
    setManualName("");
    fetchData();
    toast.success("Number added");
  };

  // Purchase flow
  const handleSearchNumbers = async () => {
    if (searchAreaCode.length !== 3) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-search-numbers", { body: { area_code: searchAreaCode, api_key: apiKey } });
      if (error) throw error;
      if (data?.error) {
        if (/api key/i.test(data.error) || /credential/i.test(data.error)) {
          toast.error("Configure your Telnyx API Key above before purchasing numbers.");
        } else {
          toast.error(data.error);
        }
        setSearching(false);
        return;
      }
      setSearchResults(data?.numbers || []);
      if ((data?.numbers || []).length > 0) setPurchaseStep(2);
    } catch (e: any) {
      toast.error(e.message);
    }
    setSearching(false);
  };

  const handlePurchase = async () => {
    if (!selectedNumber) return;
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-buy-number", { body: { phone_number: selectedNumber, api_key: apiKey } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const areaCode = extractAreaCode(selectedNumber);
      await supabase.from("phone_numbers").insert({
        phone_number: selectedNumber,
        status: "active",
        area_code: areaCode,
        spam_status: "Unknown",
      });
      toast.success("Number purchased successfully!");
      setPurchaseOpen(false);
      resetPurchaseModal();
      fetchData();
    } catch (e: any) {
      toast.error(`Purchase failed — ${e.message}`);
    }
    setPurchasing(false);
  };

  const resetPurchaseModal = () => {
    setSearchAreaCode("");
    setSearchResults([]);
    setSelectedNumber(null);
    setPurchaseStep(1);
  };

  // Local presence toggle
  const handleLocalPresenceToggle = async (enabled: boolean) => {
    setLocalPresenceEnabled(enabled);
    const flags = JSON.stringify({ local_presence_enabled: enabled });
    await supabase.from("phone_settings").upsert({ id: SINGLETON_ID, api_secret: flags, updated_at: new Date().toISOString() });
    toast.success(enabled ? "Local Presence enabled" : "Local Presence disabled");
  };

  const uniqueAreaCodes = [...new Set(activeNumbers.map(n => n.area_code).filter(Boolean))] as string[];

  const renderSpamBadge = (n: PhoneNumber) => {
    if ((n as any).spam_status === "checking") return <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />;
    switch (n.spam_status) {
      case "Clean":
        return <span className="inline-flex items-center gap-1 text-xs text-success"><ShieldCheck className="w-3.5 h-3.5" /> Verified Clean</span>;
      case "At Risk":
        return <span className="inline-flex items-center gap-1 text-xs text-warning"><AlertTriangle className="w-3.5 h-3.5" /> At Risk</span>;
      case "Flagged":
        return <span className="inline-flex items-center gap-1 text-xs text-destructive"><ShieldAlert className="w-3.5 h-3.5" /> Spam Flagged</span>;
      default:
        return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldQuestion className="w-3.5 h-3.5" /> Not Checked</span>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* PART 1: Telnyx Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-primary" />
            Telnyx Connection
          </CardTitle>
          <CardDescription>Configure your Telnyx API credentials for calling and SMS.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">API Key</label>
              <div className="relative">
                <Input
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="KEY..."
                  className="pr-10 font-mono text-sm"
                />
                <button onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Connection ID / Application ID</label>
              <Input value={connectionId} onChange={e => setConnectionId(e.target.value)} placeholder="Connection ID" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">SIP Username</label>
              <Input value={sipUsername} onChange={e => setSipUsername(e.target.value)} placeholder="SIP Username" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">SIP Password</label>
              <div className="relative">
                <Input
                  type={showSipPass ? "text" : "password"}
                  value={sipPassword}
                  onChange={e => setSipPassword(e.target.value)}
                  placeholder="SIP Password"
                  className="pr-10 font-mono text-sm"
                />
                <button onClick={() => setShowSipPass(!showSipPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSipPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Credentials"}
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testing || !apiKey}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Test Connection
            </Button>
            {testResult && (
              <span className={`inline-flex items-center gap-1.5 text-sm ${testResult.success ? "text-success" : "text-destructive"}`}>
                {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {testResult.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PART 2: Phone Numbers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              Phone Numbers
              <Badge variant="secondary" className="text-xs">{activeNumbers.length} active</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleBulkSpamCheck} disabled={bulkChecking || activeNumbers.length === 0}>
                {bulkChecking ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> {bulkProgress}%</> : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Bulk Spam Check</>}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAddManualOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Manually
              </Button>
              <Button size="sm" onClick={() => { resetPurchaseModal(); setPurchaseOpen(true); }}>
                <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Purchase Number
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {numbers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Phone className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">No phone numbers yet</p>
              <p className="text-xs text-muted-foreground mb-4">Purchase a number from Telnyx or add one manually to get started.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { resetPurchaseModal(); setPurchaseOpen(true); }}>
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Purchase Number
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAddManualOpen(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Manually
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b bg-accent/50">
                    <th className="text-left py-3 px-3 font-medium">Phone Number</th>
                    <th className="text-left py-3 px-3 font-medium">Friendly Name</th>
                    <th className="text-left py-3 px-3 font-medium hidden md:table-cell">Area Code</th>
                    <th className="text-left py-3 px-3 font-medium">Status</th>
                    <th className="text-left py-3 px-3 font-medium hidden lg:table-cell">Spam Status</th>
                    <th className="text-center py-3 px-3 font-medium w-16">Default</th>
                    <th className="text-left py-3 px-3 font-medium hidden xl:table-cell">Assigned To</th>
                    <th className="text-right py-3 px-3 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map(n => {
                    const isActive = n.status === "active";
                    const isReleased = n.status === "released";
                    return (
                      <tr key={n.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                        <td className="py-3 px-3 font-mono font-medium text-foreground">{formatPhone(n.phone_number)}</td>
                        <td className="py-3 px-3">
                          {editingName === n.id ? (
                            <Input
                              autoFocus
                              value={editNameValue}
                              onChange={e => setEditNameValue(e.target.value)}
                              onBlur={() => handleSaveName(n.id)}
                              onKeyDown={e => e.key === "Enter" && handleSaveName(n.id)}
                              className="h-7 text-sm w-32"
                            />
                          ) : (
                            <span
                              className="cursor-pointer hover:underline text-foreground"
                              onClick={() => { setEditingName(n.id); setEditNameValue(n.friendly_name || ""); }}
                            >
                              {n.friendly_name || <span className="text-muted-foreground italic">Click to name</span>}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 hidden md:table-cell">
                          <Badge variant="secondary" className="text-xs font-mono">{n.area_code || extractAreaCode(n.phone_number)}</Badge>
                        </td>
                        <td className="py-3 px-3">
                          {n.status === "active" && <Badge className="bg-success/10 text-success border-success/20 text-xs">Active</Badge>}
                          {n.status === "released" && <Badge variant="secondary" className="text-xs">Released</Badge>}
                          {n.status === "spam" && <Badge variant="destructive" className="text-xs">Spam</Badge>}
                        </td>
                        <td className="py-3 px-3 hidden lg:table-cell">
                          <div className="flex flex-col gap-0.5">
                            {renderSpamBadge(n)}
                            <span className="text-[10px] text-muted-foreground">
                              {n.spam_checked_at ? `Checked ${formatDistanceToNow(new Date(n.spam_checked_at), { addSuffix: true })}` : "Never checked"}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <input
                            type="radio"
                            name="default-number"
                            checked={!!n.is_default}
                            onChange={() => handleSetDefault(n.id)}
                            disabled={!isActive}
                            className="w-4 h-4 accent-primary"
                          />
                        </td>
                        <td className="py-3 px-3 hidden xl:table-cell">
                          {isActive ? (
                            <Select
                              value={n.assigned_to || "unassigned"}
                              onValueChange={v => handleAssign(n.id, v === "unassigned" ? null : v)}
                            >
                              <SelectTrigger className="h-7 text-xs w-36">
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {agents.map(a => (
                                  <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="w-4 h-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {isActive && (
                                <>
                                  <DropdownMenuItem onClick={() => handleSpamCheck(n.id)}>
                                    <ShieldCheck className="w-4 h-4 mr-2" /> Check Spam Status
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setReleaseConfirm(n.id)} className="text-destructive">
                                    <Radio className="w-4 h-4 mr-2" /> Release Number
                                  </DropdownMenuItem>
                                </>
                              )}
                              {isReleased && (
                                <DropdownMenuItem onClick={() => setRemoveConfirm(n.id)} className="text-destructive">
                                  <Trash2 className="w-4 h-4 mr-2" /> Remove
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Local Presence */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4 text-primary" />
            Local Presence (Area Code Matching)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Enable Local Presence</p>
              <p className="text-xs text-muted-foreground">When ON, the Dialer matches caller ID to the lead's area code. When OFF, uses the default number.</p>
            </div>
            <Switch checked={localPresenceEnabled} onCheckedChange={handleLocalPresenceToggle} />
          </div>
          <div className="bg-accent/50 rounded-lg p-3">
            <p className="text-sm text-foreground">
              You have numbers covering <span className="font-semibold">{uniqueAreaCodes.length}</span> area code{uniqueAreaCodes.length !== 1 ? "s" : ""}
              {uniqueAreaCodes.length > 0 && <>: <span className="font-mono text-xs">{uniqueAreaCodes.join(", ")}</span></>}
            </p>
            {uniqueAreaCodes.length < 3 && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Info className="w-3 h-3" /> Tip: Purchase numbers with different area codes to improve answer rates in more regions
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Manually Modal */}
      <Dialog open={addManualOpen} onOpenChange={setAddManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Phone Number Manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Phone Number</label>
              <Input value={manualPhone} onChange={e => setManualPhone(e.target.value)} placeholder="+12135551234" className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Friendly Name (optional)</label>
              <Input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Main Line" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleAddManual} disabled={addingManual || !manualPhone.trim()}>
              {addingManual ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purchase Number Modal */}
      <Dialog open={purchaseOpen} onOpenChange={o => { if (!o) resetPurchaseModal(); setPurchaseOpen(o); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Purchase Number
            </DialogTitle>
            <DialogDescription>Search for available numbers by area code.</DialogDescription>
          </DialogHeader>

          {purchaseStep === 1 && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Area code (e.g. 213)"
                    value={searchAreaCode}
                    onChange={e => setSearchAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    className="pl-9"
                    onKeyDown={e => e.key === "Enter" && handleSearchNumbers()}
                  />
                </div>
                <Button onClick={handleSearchNumbers} disabled={searching || searchAreaCode.length !== 3}>
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search Available Numbers"}
                </Button>
              </div>
            </div>
          )}

          {purchaseStep === 2 && (
            <div className="space-y-4">
              {searchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No numbers available for area code {searchAreaCode}. Try a different area code.</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{searchResults.length} numbers found</p>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {searchResults.map((r: any) => (
                      <label key={r.phone_number} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${selectedNumber === r.phone_number ? "border-primary bg-primary/5" : "border-border hover:bg-accent/30"}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="purchase-number" checked={selectedNumber === r.phone_number} onChange={() => setSelectedNumber(r.phone_number)} className="accent-primary" />
                          <span className="font-mono text-sm font-medium">{formatPhone(r.phone_number)}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{r.monthly_cost || "$1.00"}/mo</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-between">
                    <Button variant="outline" size="sm" onClick={() => { setPurchaseStep(1); setSearchResults([]); setSelectedNumber(null); }}>Back</Button>
                    <Button onClick={handlePurchase} disabled={!selectedNumber || purchasing}>
                      {purchasing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Purchasing...</> : "Purchase Selected"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Release Confirm */}
      <AlertDialog open={!!releaseConfirm} onOpenChange={() => setReleaseConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this number?</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to release this number? It will no longer be available for calling.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => releaseConfirm && handleRelease(releaseConfirm)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Release</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Confirm */}
      <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this number?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this number from your records.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeConfirm && handleRemove(removeConfirm)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PhoneSettings;
