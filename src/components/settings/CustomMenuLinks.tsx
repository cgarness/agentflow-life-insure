import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import type { CustomMenuLinkOpenMode } from "@/hooks/useCustomMenuLinks";
import { Link2, ExternalLink, Plus, Loader2, Pencil, Trash2, GripVertical, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

interface CustomMenuLink {
    id: string;
    label: string;
    url: string;
    icon: string | null;
    sort_order: number;
    open_mode: CustomMenuLinkOpenMode;
}

const CustomMenuLinks: React.FC = () => {
    const { organizationId } = useOrganization();
    const queryClient = useQueryClient();
    const [links, setLinks] = useState<CustomMenuLink[]>([]);
    const [loading, setLoading] = useState(true);

    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<CustomMenuLink | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<CustomMenuLink | null>(null);

    const [formLabel, setFormLabel] = useState("");
    const [formUrl, setFormUrl] = useState("");
    const [formOrder, setFormOrder] = useState<string>("0");
    const [formOpenMode, setFormOpenMode] = useState<CustomMenuLinkOpenMode>("new_tab");
    const [formErrors, setFormErrors] = useState<{ label?: boolean; url?: boolean }>({});
    const [saving, setSaving] = useState(false);

    const invalidateSidebarLinks = () => {
        queryClient.invalidateQueries({ queryKey: ["custom_menu_links"] });
        queryClient.invalidateQueries({ queryKey: ["custom_menu_link"] });
    };

    useEffect(() => {
        fetchLinks();
    }, [organizationId]);

    const fetchLinks = async () => {
        if (!organizationId) {
            setLinks([]);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('custom_menu_links')
                .select('*')
                .eq('organization_id', organizationId)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;

            const formatted: CustomMenuLink[] = (data || []).map(d => ({
                id: d.id,
                label: d.label,
                url: d.url,
                icon: d.icon,
                sort_order: d.sort_order || 0,
                open_mode: d.open_mode === "in_frame" ? "in_frame" : "new_tab",
            }));
            setLinks(formatted);
        } catch (error) {
            console.error("Error fetching links:", error);
            toast({ title: "Error loading custom links", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setFormLabel("");
        setFormUrl("");
        setFormOrder((links.length * 10).toString());
        setFormOpenMode("new_tab");
        setFormErrors({});
        setEditTarget(null);
        setAddOpen(true);
    };

    const openEdit = (l: CustomMenuLink) => {
        setFormLabel(l.label);
        setFormUrl(l.url);
        setFormOrder(l.sort_order.toString());
        setFormOpenMode(l.open_mode);
        setFormErrors({});
        setEditTarget(l);
        setAddOpen(true);
    };

    const isValidUrl = (url: string) => {
        try {
            new URL(url.startsWith('http') ? url : `https://${url}`);
            return true;
        } catch {
            return false;
        }
    };

    const handleSave = async () => {
        const formatUrl = formUrl.trim().startsWith('http') ? formUrl.trim() : `https://${formUrl.trim()}`;
        const errors = {
            label: !formLabel.trim(),
            url: !formUrl.trim() || !isValidUrl(formatUrl),
        };

        if (errors.label || errors.url) {
            setFormErrors(errors);
            return;
        }

        if (!organizationId) {
            toast({ title: "Organization not loaded yet", description: "Try again in a moment.", variant: "destructive" });
            return;
        }

        try {
            setSaving(true);
            const payload = {
                label: formLabel.trim(),
                url: formatUrl,
                sort_order: parseInt(formOrder, 10) || 0,
                open_mode: formOpenMode,
                updated_at: new Date().toISOString()
            };

            if (editTarget) {
                const { error } = await supabase.from('custom_menu_links').update(payload).eq('id', editTarget.id);
                if (error) throw error;
                toast({ title: "Link updated", className: "bg-success text-success-foreground border-success" });
            } else {
                const { error } = await supabase.from('custom_menu_links').insert({ ...payload, organization_id: organizationId } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
                if (error) throw error;
                toast({ title: "Link created", className: "bg-success text-success-foreground border-success" });
            }

            setAddOpen(false);
            fetchLinks();
            invalidateSidebarLinks();
        } catch (error) {
            toast({ title: "Failed to save link", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            setSaving(true);
            const { error } = await supabase.from('custom_menu_links').delete().eq('id', deleteTarget.id);
            if (error) throw error;

            setLinks(prev => prev.filter(l => l.id !== deleteTarget.id));
            toast({ title: "Link deleted", className: "bg-success text-success-foreground border-success" });
            invalidateSidebarLinks();
        } catch (error) {
            toast({ title: "Failed to delete link", variant: "destructive" });
        } finally {
            setSaving(false);
            setDeleteTarget(null);
        }
    };

    const shiftOrder = async (id: string, dir: -1 | 1) => {
        const idx = links.findIndex(l => l.id === id);
        if (idx < 0) return;
        if (dir === -1 && idx === 0) return;
        if (dir === 1 && idx === links.length - 1) return;

        const current = links[idx];
        const swap = links[idx + dir];

        const newLinks = [...links];
        newLinks[idx] = { ...current, sort_order: swap.sort_order };
        newLinks[idx + dir] = { ...swap, sort_order: current.sort_order };

        // optimistically update UI sorting
        newLinks.sort((a, b) => a.sort_order - b.sort_order);
        setLinks(newLinks);

        try {
            // update backend
            await Promise.all([
                supabase.from('custom_menu_links').update({ sort_order: swap.sort_order }).eq('id', current.id),
                supabase.from('custom_menu_links').update({ sort_order: current.sort_order }).eq('id', swap.id)
            ]);
            invalidateSidebarLinks();
        } catch (error) {
            toast({ title: "Failed to reorder", variant: "destructive" });
            fetchLinks(); // revert
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Custom Menu Links</h3>
                    <p className="text-sm text-muted-foreground">
                        Add links to your agency sidebar (above Settings). Choose whether each opens in a new browser tab or inside AgentFlow next to the dialer and menus.
                    </p>
                </div>
                <Button onClick={openAdd} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Link
                </Button>
            </div>

            <div className="bg-card rounded-xl border overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : links.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 text-center border-dashed">
                        <LinkIcon className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                        <p className="text-foreground font-medium text-lg">No custom links yet</p>
                        <p className="text-sm text-muted-foreground mb-4">Add important external tools directly into your sidebar.</p>
                        <Button size="sm" onClick={openAdd} className="gap-2">
                            <Plus className="w-4 h-4" /> Create Link
                        </Button>
                    </div>
                ) : (
                    <div className="divide-y relative">
                        {links.map((l, i) => (
                            <div key={l.id} className="flex items-center justify-between p-3 hover:bg-accent/50 sidebar-transition group">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="flex flex-col opacity-20 group-hover:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" className="h-5 w-5 p-0 hover:bg-transparent hover:text-primary -mb-1" onClick={() => shiftOrder(l.id, -1)} disabled={i === 0}>
                                            <GripVertical className="w-4 h-4 rotate-90" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-5 w-5 p-0 hover:bg-transparent hover:text-primary mt-0" onClick={() => shiftOrder(l.id, 1)} disabled={i === links.length - 1}>
                                            <GripVertical className="w-4 h-4 rotate-90" />
                                        </Button>
                                    </div>

                                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                        <Link2 className="w-5 h-5 text-primary" />
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="font-semibold text-foreground">{l.label}</h4>
                                            <Badge variant="secondary" className="text-[10px] font-normal">
                                                {l.open_mode === "in_frame" ? "Inside AgentFlow" : "New tab"}
                                            </Badge>
                                        </div>
                                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary hover:underline flex items-center gap-1.5 truncate mt-0.5">
                                            {l.url} <ExternalLink className="w-3 h-3 shrink-0" />
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/10 hover:text-primary" onClick={() => openEdit(l)}>
                                        <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget(l)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editTarget ? "Edit Menu Link" : "Add Menu Link"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">Label</label>
                            <Input
                                value={formLabel}
                                onChange={(e) => { setFormLabel(e.target.value); setFormErrors(prev => ({ ...prev, label: false })); }}
                                placeholder="e.g. Employee Handbook"
                                className={formErrors.label ? "border-destructive focus-visible:ring-destructive" : ""}
                                onKeyDown={(e) => { if (e.key === "Enter" && !saving) handleSave(); }}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">URL</label>
                            <Input
                                value={formUrl}
                                onChange={(e) => { setFormUrl(e.target.value); setFormErrors(prev => ({ ...prev, url: false })); }}
                                placeholder="https://docs.google.com/..."
                                className={formErrors.url ? "border-destructive focus-visible:ring-destructive" : ""}
                                onKeyDown={(e) => { if (e.key === "Enter" && !saving) handleSave(); }}
                            />
                            {formErrors.url && <p className="text-xs text-destructive mt-1.5">Please enter a valid URL.</p>}
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-medium text-foreground">How it opens</Label>
                            <RadioGroup value={formOpenMode} onValueChange={(v) => setFormOpenMode(v as CustomMenuLinkOpenMode)} className="grid gap-3">
                                <div className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
                                    <RadioGroupItem value="new_tab" id="open-new-tab" className="mt-1 shrink-0" />
                                    <label htmlFor="open-new-tab" className="flex-1 cursor-pointer leading-snug">
                                        <span className="text-sm font-medium text-foreground">New tab</span>
                                        <p className="text-xs text-muted-foreground mt-1">Opens the URL in a separate browser tab (best for sites that cannot be embedded).</p>
                                    </label>
                                </div>
                                <div className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
                                    <RadioGroupItem value="in_frame" id="open-in-frame" className="mt-1 shrink-0" />
                                    <label htmlFor="open-in-frame" className="flex-1 cursor-pointer leading-snug">
                                        <span className="text-sm font-medium text-foreground">Inside AgentFlow</span>
                                        <p className="text-xs text-muted-foreground mt-1">Shows the page in the main area while keeping the AgentFlow sidebar and header. Some external sites may block this.</p>
                                    </label>
                                </div>
                            </RadioGroup>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving} className="gap-2">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {editTarget ? "Save Changes" : "Create Link"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => (!o && !saving) && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Link</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove <span className="font-semibold text-foreground">"{deleteTarget?.label}"</span> from the sidebar menu?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving}>
                            Remove Link
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default CustomMenuLinks;
