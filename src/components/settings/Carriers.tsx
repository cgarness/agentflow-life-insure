import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { logActivity } from "@/lib/activityLogger";
import { Shield, Plus, Loader2, Search, Pencil, Trash2, ShieldCheck, ShieldAlert, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import CarrierContactsEditor from "./CarrierContactsEditor";
import {
  type LabeledContact,
  parseLabeledContacts,
  compactLabeledContacts,
  validateEmailRows,
} from "./carrierContactUtils";
import { carrierSchema } from "./carriers/carrierSchema";
import CarrierResourceLinksEditor from "./carriers/CarrierResourceLinksEditor";
import { carrierResourceLinksSchema, safeCarrierWebUrl, safeCarrierLogoUrl, type CarrierResourceLink, type CarrierResourceErrors } from "@/lib/carrierResources";
import { CARRIER_DIRECTORY_QUERY_KEY } from "@/hooks/useCarrierDirectory";

interface Carrier {
  id: string;
  name: string;
  portal_url: string | null;
  logo_url: string | null;
  contact_phones: LabeledContact[];
  contact_emails: LabeledContact[];
  is_appointed: boolean;
  resource_links: CarrierResourceLink[];
  updated_at: string;
  updatedAt: Date;
}

const Carriers: React.FC = () => {
  const { user, profile, isImpersonating, isBuildingOrganization } = useAuth();
  const { organizationId } = useOrganization();
  if (!user || profile?.id !== user.id || !organizationId || profile.organization_id !== organizationId || isImpersonating || isBuildingOrganization) return null;
  return <CarrierSettings key={`${user.id}|${organizationId}|${profile.role}|${profile.is_super_admin}`} />;
};

// Existing legacy Settings form; new directory and resource editor are extracted components.
const CarrierSettings: React.FC = () => {
  const { organizationId } = useOrganization();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const canManage = profile?.is_super_admin === true || profile?.role?.toLowerCase() === "admin";
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Carrier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Carrier | null>(null);

  const [formName, setFormName] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formAppointed, setFormAppointed] = useState(false);
  const [formLogoUrl, setFormLogoUrl] = useState<string | null>(null);
  const [formLogoPaste, setFormLogoPaste] = useState("");
  const [formPhones, setFormPhones] = useState<LabeledContact[]>([]);
  const [formEmails, setFormEmails] = useState<LabeledContact[]>([]);
  const [formLinks, setFormLinks] = useState<CarrierResourceLink[]>([]);
  const [resourceErrors, setResourceErrors] = useState<CarrierResourceErrors>({});
  const [formEmailErrors, setFormEmailErrors] = useState<Record<number, boolean>>({});
  const [formErrors, setFormErrors] = useState<{ name?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const fetchVersion = useRef(0);
  const mutationPending = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; fetchVersion.current += 1; };
  }, []);

  const fetchCarriers = useCallback(async () => {
    if (!organizationId) return;
    const request = ++fetchVersion.current;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("carriers")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name", { ascending: true });

      if (error) throw error;
      if (!active.current || request !== fetchVersion.current) return;

      const formatted: Carrier[] = (data || []).map((d) => ({
        id: d.id,
        name: d.name,
        portal_url: d.portal_url,
        logo_url: d.logo_url ?? null,
        contact_phones: parseLabeledContacts(d.contact_phones),
        contact_emails: parseLabeledContacts(d.contact_emails),
        is_appointed: d.is_appointed || false,
        resource_links: carrierResourceLinksSchema.parse(d.resource_links),
        updated_at: d.updated_at,
        updatedAt: new Date(d.updated_at),
      }));
      setCarriers(formatted);
      setLoadError(false);
    } catch (error) {
      if (active.current && request === fetchVersion.current) setLoadError(true);
    } finally {
      if (active.current && request === fetchVersion.current) setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void fetchCarriers(); }, [fetchCarriers]);

  const openAdd = () => {
    if (!canManage) return;
    setFormName("");
    setFormUrl("");
    setFormAppointed(true);
    setFormLogoUrl(null);
    setFormLogoPaste("");
    setFormPhones([]);
    setFormEmails([]);
    setFormLinks([]);
    setResourceErrors({});
    setFormEmailErrors({});
    setFormErrors({});
    setEditTarget(null);
    setAddOpen(true);
  };

  const openEdit = (c: Carrier) => {
    if (!canManage) return;
    setFormName(c.name);
    setFormUrl(c.portal_url || "");
    setFormAppointed(c.is_appointed);
    setFormLogoUrl(c.logo_url);
    setFormLogoPaste(c.logo_url && !c.logo_url.startsWith("data:") ? c.logo_url : "");
    setFormPhones(c.contact_phones.length ? [...c.contact_phones] : []);
    setFormEmails(c.contact_emails.length ? [...c.contact_emails] : []);
    setFormLinks(c.resource_links.map((link) => ({ ...link })));
    setResourceErrors({});
    setFormEmailErrors({});
    setFormErrors({});
    setEditTarget(c);
    setAddOpen(true);
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Use JPG, PNG, or WebP.", variant: "destructive" });
      e.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum size is 5MB.", variant: "destructive" });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (!active.current) return;
      setFormLogoUrl(reader.result as string);
      setFormLogoPaste("");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const applyLogoPaste = () => {
    const t = formLogoPaste.trim();
    if (!t) {
      toast({ title: "Paste a URL first", variant: "destructive" });
      return;
    }
    setFormLogoUrl(t);
  };

  const handleSave = async () => {
    if (mutationPending.current) return;
    if (!canManage || !organizationId) {
      toast({ title: "Unauthorized", description: "You do not have permission to manage carriers.", variant: "destructive" });
      return;
    }

    const current = {
      name: formName,
      portal_url: formUrl || null,
      logo_url: formLogoUrl || null,
      contact_phones: formPhones,
      contact_emails: formEmails,
      is_appointed: formAppointed,
      resource_links: formLinks,
    };
    // Validate and send only deliberately edited fields. A resource edit must never
    // normalize a legacy name/URL/contact or overwrite unrelated concurrent work.
    const original = editTarget ? {
      name: editTarget.name, portal_url: editTarget.portal_url || null,
      logo_url: editTarget.logo_url || null, contact_phones: editTarget.contact_phones,
      contact_emails: editTarget.contact_emails, is_appointed: editTarget.is_appointed,
      resource_links: editTarget.resource_links,
    } : null;
    const changed = original ? Object.fromEntries(Object.entries(current).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(original[key as keyof typeof original]))) : current;
    const validation = editTarget ? carrierSchema.partial().safeParse(changed) : carrierSchema.safeParse(current);

    if (!validation.success) {
      const fieldErrors = validation.error.flatten().fieldErrors;
      const firstError = Object.values(fieldErrors)[0]?.[0];
      
      const emailErrorsMap: Record<number, boolean> = {};
      const linkErrors: CarrierResourceErrors = {};
      validation.error.issues.forEach((issue) => {
        if (issue.path[0] === "contact_emails" && typeof issue.path[1] === "number") {
          emailErrorsMap[issue.path[1]] = true;
        }
        if (issue.path[0] === "resource_links" && typeof issue.path[1] === "number") {
          const id = formLinks[issue.path[1]]?.id;
          const field = issue.path[2];
          if (id && (field === "label" || field === "url" || field === "group")) linkErrors[id] = { ...linkErrors[id], [field]: issue.message };
        }
      });
      setFormEmailErrors(emailErrorsMap);
      setResourceErrors(linkErrors);
      
      const hasNameError = validation.error.issues.some((issue) => issue.path[0] === "name");
      if (hasNameError) {
        setFormErrors({ name: true });
      }

      toast({
        title: "Validation error",
        description: firstError || "Please check your inputs.",
        variant: "destructive",
      });
      return;
    }

    setFormEmailErrors({});
    setFormErrors({});
    setResourceErrors({});

    const validData = validation.data;
    if (editTarget && Object.keys(validData).length === 0) { setAddOpen(false); return; }
    const displayName = validData.name ?? editTarget?.name ?? formName;

    try {
      mutationPending.current = true;
      setSaving(true);
      const payload = validData;

      if (editTarget) {
        const { data, error } = await supabase
          .from("carriers")
          .update(payload)
          .eq("id", editTarget.id)
          .eq("organization_id", organizationId)
          .eq("updated_at", editTarget.updated_at)
          .select("id")
          .maybeSingle();
        if (!active.current) return;
        if (error) {
          if (error.code === "23505" || error.message?.includes("carriers_org_lower_name_unique")) {
            toast({ title: "A carrier with this name already exists.", variant: "destructive" });
            return;
          }
          throw error;
        }
        if (!data) {
          void fetchCarriers();
          throw new Error("Carrier changed or is no longer available. Your edits are still here; reopen the carrier to load the latest version.");
        }
        toast({ title: "Carrier updated", className: "bg-success text-success-foreground border-success" });
        void logActivity({
          action: `Updated carrier "${displayName}"`,
          category: "settings",
          organizationId: organizationId,
          userId: user?.id,
          userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
          metadata: { carrierId: editTarget.id, name: displayName, isAppointed: formAppointed, organization_id: organizationId },
        });
      } else {
        const { data, error } = await supabase
          .from("carriers")
          .insert({
            ...payload,
            name: displayName,
            organization_id: organizationId,
          })
          .select("id")
          .maybeSingle();
        if (!active.current) return;
        if (error) {
          if (error.code === "23505" || error.message?.includes("carriers_org_lower_name_unique")) {
            toast({ title: "A carrier with this name already exists.", variant: "destructive" });
            return;
          }
          throw error;
        }
        if (!data) throw new Error("The carrier save could not be confirmed. Your edits are still here.");
        toast({ title: "Carrier added", className: "bg-success text-success-foreground border-success" });
        void logActivity({
          action: `Added carrier "${displayName}"`,
          category: "settings",
          organizationId: organizationId,
          userId: user?.id,
          userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
          metadata: { name: displayName, isAppointed: formAppointed, organization_id: organizationId },
        });
      }

      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: CARRIER_DIRECTORY_QUERY_KEY });
      void fetchCarriers();
    } catch (error) {
      if (active.current) toast({ title: "Failed to save carrier", description: error instanceof Error ? error.message : "Your edits are still here. Please try again.", variant: "destructive" });
    } finally {
      mutationPending.current = false;
      if (active.current) setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || mutationPending.current) return;
    if (!canManage || !organizationId) {
      toast({ title: "Unauthorized", description: "You do not have permission to manage carriers.", variant: "destructive" });
      return;
    }
    try {
      mutationPending.current = true;
      setSaving(true);
      const { data, error } = await supabase
        .from("carriers")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("organization_id", organizationId)
        .select("id")
        .maybeSingle();
      if (!active.current) return;
      if (error) throw error;
      if (!data) throw new Error("Carrier is no longer available");

      setCarriers((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: CARRIER_DIRECTORY_QUERY_KEY });
      toast({ title: "Carrier deleted", className: "bg-success text-success-foreground border-success" });
      void logActivity({
        action: `Removed carrier "${deleteTarget.name}"`,
        category: "settings",
        organizationId: organizationId,
        userId: user?.id,
        userName: profile ? `${profile.first_name} ${profile.last_name}` : undefined,
        metadata: { carrierId: deleteTarget.id, name: deleteTarget.name, organization_id: organizationId },
      });
    } catch (error) {
      if (active.current) toast({ title: "Failed to delete carrier", variant: "destructive" });
    } finally {
      mutationPending.current = false;
      if (active.current) setSaving(false);
    }
  };

  const toggleAppointed = async (id: string, currentVal: boolean) => {
    if (mutationPending.current) return;
    if (!canManage || !organizationId) {
      toast({ title: "Unauthorized", description: "You do not have permission to manage carriers.", variant: "destructive" });
      return;
    }
    try {
      mutationPending.current = true;
      setSaving(true);
      const { data, error } = await supabase
        .from("carriers")
        .update({
          is_appointed: !currentVal,
        })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("updated_at")
        .maybeSingle();

      if (!active.current) return;
      if (error) throw error;
      if (!data) throw new Error("Carrier is no longer available");
      setCarriers((prev) => prev.map((c) => c.id === id ? { ...c, is_appointed: !currentVal, updated_at: data.updated_at, updatedAt: new Date(data.updated_at) } : c));
      void queryClient.invalidateQueries({ queryKey: CARRIER_DIRECTORY_QUERY_KEY });
      toast({ title: "Status updated", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      if (active.current) toast({ title: "Failed to update status", variant: "destructive" });
    } finally {
      mutationPending.current = false;
      if (active.current) setSaving(false);
    }
  };

  const onEmailsChange = (rows: LabeledContact[]) => {
    setFormEmails(rows);
    setFormEmailErrors({});
  };

  const filtered = carriers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const firstPhone = (c: Carrier) => c.contact_phones.find((p) => p.value.trim());
  const firstEmail = (c: Carrier) => c.contact_emails.find((e) => e.value.trim());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Carriers</h3>
        </div>
        {canManage && (
          <Button onClick={openAdd} disabled={saving} className="gap-2">
            <Plus className="w-4 h-4" /> Add Carrier
          </Button>
        )}
      </div>

      {!canManage && (
        <div className="flex items-center gap-2 bg-accent/40 border border-border p-3 rounded-lg text-sm text-muted-foreground">
          <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
          <span>Carrier settings are managed by agency admins.</span>
        </div>
      )}

      <div className="relative w-full max-w-72">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input aria-label="Search carrier settings" placeholder="Search carriers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-card" />
      </div>

      <div className="bg-card rounded-xl border divide-y overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : loadError ? (
          <div role="alert" className="space-y-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">Unable to load carriers. Please try again.</p>
            <Button variant="outline" onClick={() => void fetchCarriers()}>Retry</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Shield className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-foreground font-medium text-lg">No carriers found</p>
            {canManage ? (
              <Button size="sm" onClick={openAdd} className="mt-4 gap-2">
                <Plus className="w-4 h-4" /> Add Carrier
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">No carriers have been added by your agency admins yet.</p>
            )}
          </div>
        ) : (
          filtered.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between p-4 hover:bg-accent/50 sidebar-transition gap-3">
              <div className="flex basis-full items-center gap-3 flex-1 min-w-0 sm:basis-0">
                <div className="w-11 h-11 rounded-lg border border-border bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                  {safeCarrierLogoUrl(c.logo_url) ? (
                    <img src={safeCarrierLogoUrl(c.logo_url)!} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className={`p-1.5 rounded-full flex items-center justify-center shrink-0 ${c.is_appointed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {c.is_appointed ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-foreground text-base truncate">{c.name}</h4>
                  {safeCarrierWebUrl(c.portal_url) ? (
                    <a
                      href={safeCarrierWebUrl(c.portal_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline truncate inline-block max-w-full mt-0.5"
                    >
                      {c.portal_url}
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground mt-0.5 block italic">No portal URL provided</span>
                  )}
                  {(() => {
                    const fp = firstPhone(c);
                    const fe = firstEmail(c);
                    const totalFilled =
                      c.contact_phones.filter((p) => p.value.trim()).length + c.contact_emails.filter((e) => e.value.trim()).length;
                    const shownCount = (fp ? 1 : 0) + (fe ? 1 : 0);
                    if (!fp && !fe) return null;
                    const telHref = fp ? `tel:${(fp.value.replace(/[^\d+]/g, "") || fp.value).trim()}` : "";
                    return (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                        {fp && (
                          <a href={telHref} className="text-primary hover:underline shrink-0">
                            {fp.label ? `${fp.label}: ` : ""}
                            {fp.value}
                          </a>
                        )}
                        {fe && (
                          <a href={`mailto:${encodeURIComponent(fe.value.trim())}`} className="text-primary hover:underline truncate max-w-[200px]">
                            {fe.label ? `${fe.label}: ` : ""}
                            {fe.value}
                          </a>
                        )}
                        {totalFilled > shownCount ? <span className="text-muted-foreground">(+{totalFilled - shownCount} more)</span> : null}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="flex w-full items-center justify-end gap-4 shrink-0 sm:w-auto">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium w-20 text-right ${c.is_appointed ? "text-success" : "text-muted-foreground"}`}>
                    {c.is_appointed ? "Appointed" : "Pending"}
                  </span>
                  <Switch 
                    checked={c.is_appointed} 
                    onCheckedChange={() => toggleAppointed(c.id, c.is_appointed)} 
                    className="scale-90" 
                    disabled={!canManage || saving}
                  />
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 border-l pl-3 border-border/50">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} disabled={saving} onClick={() => openEdit(c)} className="h-8 w-8 hover:bg-primary/10 hover:text-primary">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Remove ${c.name}`} disabled={saving} onClick={() => setDeleteTarget(c)} className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive text-muted-foreground">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { if (!saving) setAddOpen(open); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Carrier" : "Add Carrier"}</DialogTitle>
            <DialogDescription>Keep your agency’s carrier links and contact details up to date.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={saving} className="min-w-0 space-y-4 py-2">
            <div>
              <label htmlFor="carrier-name" className="text-sm font-medium text-foreground mb-1.5 block">Carrier Name</label>
              <Input
                id="carrier-name"
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value);
                  setFormErrors({});
                }}
                placeholder="e.g. Mutual of Omaha"
                className={formErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
              />
            </div>
            <div>
              <label htmlFor="carrier-portal" className="text-sm font-medium text-foreground mb-1.5 block">
                Agent Portal URL <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <Input id="carrier-portal" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="e.g. https://agents.mutualofomaha.com" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground block">Carrier logo</label>
              <div className="flex flex-wrap items-center gap-3">
                {safeCarrierLogoUrl(formLogoUrl) ? (
                  <div className="relative w-20 h-20 rounded-lg border border-border bg-muted overflow-hidden shrink-0">
                    <img src={safeCarrierLogoUrl(formLogoUrl)!} alt="" className="w-full h-full object-contain" />
                    <button
                      type="button"
                      className="absolute top-1 right-1 p-0.5 rounded bg-background/90 border shadow-sm hover:bg-destructive/10 text-destructive"
                      onClick={() => {
                        setFormLogoUrl(null);
                        setFormLogoPaste("");
                      }}
                      aria-label="Remove logo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
                <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
                  <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleLogoFile} />
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => logoFileRef.current?.click()}>
                    Upload image
                  </Button>
                  <div className="flex gap-2 flex-wrap items-end">
                    <Input value={formLogoPaste} onChange={(e) => setFormLogoPaste(e.target.value)} placeholder="Or paste image URL (https://…)" className="flex-1 min-w-[180px]" />
                    <Button type="button" variant="secondary" size="sm" onClick={applyLogoPaste}>
                      Use URL
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">JPG, PNG, or WebP. Max 5MB for uploads.</p>
                </div>
              </div>
            </div>

            <CarrierContactsEditor
              phones={formPhones}
              emails={formEmails}
              onPhonesChange={setFormPhones}
              onEmailsChange={onEmailsChange}
              emailErrors={formEmailErrors}
            />

            <CarrierResourceLinksEditor
              links={formLinks}
              onChange={(links) => { setFormLinks(links); setResourceErrors({}); }}
              disabled={saving}
              errors={resourceErrors}
            />

            <div className="flex items-center justify-between bg-accent/30 p-3 rounded-lg border">
              <div className="space-y-0.5">
                <label className="text-sm font-medium text-foreground block">Appointed Status</label>
                <span className="text-xs text-muted-foreground">Are you currently appointed to sell for them?</span>
              </div>
              <Switch checked={formAppointed} onCheckedChange={setFormAppointed} />
            </div>
          </fieldset>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editTarget ? "Save Changes" : "Add Carrier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !saving) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Carrier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <span className="font-semibold text-foreground">&quot;{deleteTarget?.name}&quot;</span>? This will remove the carrier from your settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving}>
              Remove Carrier
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Carriers;
