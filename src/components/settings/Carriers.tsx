import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Shield, Plus, Loader2, Search, Pencil, Trash2, ShieldCheck, ShieldAlert, ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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

interface Carrier {
  id: string;
  name: string;
  portal_url: string | null;
  logo_url: string | null;
  contact_phones: LabeledContact[];
  contact_emails: LabeledContact[];
  is_appointed: boolean;
  updatedAt: Date;
}

const Carriers: React.FC = () => {
  const { organizationId } = useOrganization();
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [formEmailErrors, setFormEmailErrors] = useState<Record<number, boolean>>({});
  const [formErrors, setFormErrors] = useState<{ name?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCarriers();
  }, []);

  const fetchCarriers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from("carriers").select("*").order("name", { ascending: true });

      if (error) throw error;

      const formatted: Carrier[] = (data || []).map((d) => ({
        id: d.id,
        name: d.name,
        portal_url: d.portal_url,
        logo_url: d.logo_url ?? null,
        contact_phones: parseLabeledContacts(d.contact_phones),
        contact_emails: parseLabeledContacts(d.contact_emails),
        is_appointed: d.is_appointed || false,
        updatedAt: new Date(d.updated_at),
      }));
      setCarriers(formatted);
    } catch (error) {
      console.error("Error fetching carriers:", error);
      toast({ title: "Error loading carriers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setFormName("");
    setFormUrl("");
    setFormAppointed(true);
    setFormLogoUrl(null);
    setFormLogoPaste("");
    setFormPhones([]);
    setFormEmails([]);
    setFormEmailErrors({});
    setFormErrors({});
    setEditTarget(null);
    setAddOpen(true);
  };

  const openEdit = (c: Carrier) => {
    setFormName(c.name);
    setFormUrl(c.portal_url || "");
    setFormAppointed(c.is_appointed);
    setFormLogoUrl(c.logo_url);
    setFormLogoPaste(c.logo_url && !c.logo_url.startsWith("data:") ? c.logo_url : "");
    setFormPhones(c.contact_phones.length ? [...c.contact_phones] : []);
    setFormEmails(c.contact_emails.length ? [...c.contact_emails] : []);
    setFormEmailErrors({});
    setFormErrors({});
    setEditTarget(c);
    setAddOpen(true);
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Use JPG, PNG, WebP, or SVG.", variant: "destructive" });
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
    if (!formName.trim()) {
      setFormErrors({ name: true });
      return;
    }

    const emailErrs = validateEmailRows(formEmails);
    if (Object.keys(emailErrs).length > 0) {
      setFormEmailErrors(emailErrs);
      toast({ title: "Fix email errors", description: "One or more email addresses look invalid.", variant: "destructive" });
      return;
    }
    setFormEmailErrors({});

    const phonesPayload = compactLabeledContacts(formPhones);
    const emailsPayload = compactLabeledContacts(formEmails);

    try {
      setSaving(true);
      const payload = {
        name: formName.trim(),
        portal_url: formUrl.trim() || null,
        logo_url: formLogoUrl?.trim() || null,
        contact_phones: phonesPayload,
        contact_emails: emailsPayload,
        is_appointed: formAppointed,
        updated_at: new Date().toISOString(),
      };

      if (editTarget) {
        const { error } = await supabase.from("carriers").update(payload).eq("id", editTarget.id);
        if (error) throw error;
        toast({ title: "Carrier updated", className: "bg-success text-success-foreground border-success" });
      } else {
        const { error } = await supabase.from("carriers").insert({
          ...payload,
          organization_id: organizationId,
        } as Record<string, unknown>);
        if (error) throw error;
        toast({ title: "Carrier added", className: "bg-success text-success-foreground border-success" });
      }

      setAddOpen(false);
      fetchCarriers();
    } catch (error) {
      console.error(error);
      toast({ title: "Failed to save carrier", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setSaving(true);
      const { error } = await supabase.from("carriers").delete().eq("id", deleteTarget.id);
      if (error) throw error;

      setCarriers((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      toast({ title: "Carrier deleted", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to delete carrier", variant: "destructive" });
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  const toggleAppointed = async (id: string, currentVal: boolean) => {
    try {
      setCarriers((prev) => prev.map((c) => (c.id === id ? { ...c, is_appointed: !currentVal, updatedAt: new Date() } : c)));

      const { error } = await supabase
        .from("carriers")
        .update({
          is_appointed: !currentVal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;
      toast({ title: "Status updated", className: "bg-success text-success-foreground border-success" });
    } catch (error) {
      toast({ title: "Failed to update status", variant: "destructive" });
      fetchCarriers();
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
          <p className="text-sm text-muted-foreground">Manage your insurance carrier appointments, logos, and contact numbers</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="w-4 h-4" /> Add Carrier
        </Button>
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search carriers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 bg-card" />
      </div>

      <div className="bg-card rounded-xl border divide-y overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Shield className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-foreground font-medium text-lg">No carriers found</p>
            <p className="text-sm text-muted-foreground mb-4">Add your first insurance carrier to begin tracking appointments.</p>
            <Button size="sm" onClick={openAdd} className="gap-2">
              <Plus className="w-4 h-4" /> Add Carrier
            </Button>
          </div>
        ) : (
          filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-4 hover:bg-accent/50 sidebar-transition gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-11 h-11 rounded-lg border border-border bg-muted shrink-0 overflow-hidden flex items-center justify-center">
                  {c.logo_url ? (
                    <img src={c.logo_url} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className={`p-1.5 rounded-full flex items-center justify-center shrink-0 ${c.is_appointed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
                  {c.is_appointed ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-foreground text-base truncate">{c.name}</h4>
                  {c.portal_url ? (
                    <a
                      href={c.portal_url.startsWith("http") ? c.portal_url : `https://${c.portal_url}`}
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

              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium w-20 text-right ${c.is_appointed ? "text-success" : "text-muted-foreground"}`}>
                    {c.is_appointed ? "Appointed" : "Pending"}
                  </span>
                  <Switch checked={c.is_appointed} onCheckedChange={() => toggleAppointed(c.id, c.is_appointed)} className="scale-90" />
                </div>

                <div className="flex items-center gap-1 border-l pl-3 border-border/50">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)} className="h-8 w-8 hover:bg-primary/10 hover:text-primary">
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)} className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive text-muted-foreground">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Carrier" : "Add Carrier"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Carrier Name</label>
              <Input
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
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Agent Portal URL <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <Input value={formUrl} onChange={(e) => setFormUrl(e.target.value)} placeholder="e.g. https://agents.mutualofomaha.com" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground block">Carrier logo</label>
              <div className="flex flex-wrap items-center gap-3">
                {formLogoUrl ? (
                  <div className="relative w-20 h-20 rounded-lg border border-border bg-muted overflow-hidden shrink-0">
                    <img src={formLogoUrl} alt="" className="w-full h-full object-contain" />
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
                  <input ref={logoFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="hidden" onChange={handleLogoFile} />
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => logoFileRef.current?.click()}>
                    Upload image
                  </Button>
                  <div className="flex gap-2 flex-wrap items-end">
                    <Input value={formLogoPaste} onChange={(e) => setFormLogoPaste(e.target.value)} placeholder="Or paste image URL (https://…)" className="flex-1 min-w-[180px]" />
                    <Button type="button" variant="secondary" size="sm" onClick={applyLogoPaste}>
                      Use URL
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">JPG, PNG, WebP, or SVG. Max 5MB for uploads.</p>
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

            <div className="flex items-center justify-between bg-accent/30 p-3 rounded-lg border">
              <div className="space-y-0.5">
                <label className="text-sm font-medium text-foreground block">Appointed Status</label>
                <span className="text-xs text-muted-foreground">Are you currently appointed to sell for them?</span>
              </div>
              <Switch checked={formAppointed} onCheckedChange={setFormAppointed} />
            </div>
          </div>
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
