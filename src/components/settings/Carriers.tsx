import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Plus, Loader2, Search, Pencil, Trash2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

interface Carrier {
    id: string;
    name: string;
    portal_url: string | null;
    is_appointed: boolean;
    updatedAt: Date;
}

const Carriers: React.FC = () => {
    const [carriers, setCarriers] = useState<Carrier[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Carrier | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Carrier | null>(null);

    const [formName, setFormName] = useState("");
    const [formUrl, setFormUrl] = useState("");
    const [formAppointed, setFormAppointed] = useState(false);
    const [formErrors, setFormErrors] = useState<{ name?: boolean }>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCarriers();
    }, []);

    const fetchCarriers = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('carriers')
                .select('*')
                .order('name', { ascending: true });

            if (error) throw error;

            const formatted: Carrier[] = (data || []).map(d => ({
                id: d.id,
                name: d.name,
                portal_url: d.portal_url,
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
        setFormErrors({});
        setEditTarget(null);
        setAddOpen(true);
    };

    const openEdit = (c: Carrier) => {
        setFormName(c.name);
        setFormUrl(c.portal_url || "");
        setFormAppointed(c.is_appointed);
        setFormErrors({});
        setEditTarget(c);
        setAddOpen(true);
    };

    const handleSave = async () => {
        if (!formName.trim()) {
            setFormErrors({ name: true });
            return;
        }

        try {
            setSaving(true);
            const payload = {
                name: formName.trim(),
                portal_url: formUrl.trim() || null,
                is_appointed: formAppointed,
                updated_at: new Date().toISOString()
            };

            if (editTarget) {
                const { error } = await supabase.from('carriers').update(payload).eq('id', editTarget.id);
                if (error) throw error;
                toast({ title: "Carrier updated", className: "bg-success text-success-foreground border-success" });
            } else {
                const { error } = await supabase.from('carriers').insert(payload);
                if (error) throw error;
                toast({ title: "Carrier added", className: "bg-success text-success-foreground border-success" });
            }

            setAddOpen(false);
            fetchCarriers();
        } catch (error) {
            toast({ title: "Failed to save carrier", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            setSaving(true);
            const { error } = await supabase.from('carriers').delete().eq('id', deleteTarget.id);
            if (error) throw error;

            setCarriers(prev => prev.filter(c => c.id !== deleteTarget.id));
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
            // Optimistic
            setCarriers(prev => prev.map(c => c.id === id ? { ...c, is_appointed: !currentVal, updatedAt: new Date() } : c));

            const { error } = await supabase.from('carriers').update({
                is_appointed: !currentVal,
                updated_at: new Date().toISOString()
            }).eq('id', id);

            if (error) throw error;
            toast({ title: "Status updated", className: "bg-success text-success-foreground border-success" });
        } catch (error) {
            toast({ title: "Failed to update status", variant: "destructive" });
            fetchCarriers(); // Revert
        }
    };

    const filtered = carriers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Carriers</h3>
                    <p className="text-sm text-muted-foreground">Manage your insurance carrier appointments and agent portals</p>
                </div>
                <Button onClick={openAdd} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Carrier
                </Button>
            </div>

            <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="Search carriers..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 bg-card"
                />
            </div>

            <div className="bg-card rounded-xl border divide-y overflow-hidden">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
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
                    filtered.map(c => (
                        <div key={c.id} className="flex items-center justify-between p-4 hover:bg-accent/50 sidebar-transition">
                            <div className="flex items-center gap-4 flex-1">
                                <div className={`p-2 rounded-full flex items-center justify-center shrink-0 ${c.is_appointed ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                                    }`}>
                                    {c.is_appointed ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-foreground text-base truncate">{c.name}</h4>
                                    {c.portal_url ? (
                                        <a href={c.portal_url.startsWith('http') ? c.portal_url : `https://${c.portal_url}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate inline-block max-w-sm mt-0.5">
                                            {c.portal_url}
                                        </a>
                                    ) : (
                                        <span className="text-sm text-muted-foreground mt-0.5 block italic">No portal URL provided</span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-6 shrink-0 ml-4">
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs font-medium w-20 text-right ${c.is_appointed ? 'text-success' : 'text-muted-foreground'}`}>
                                        {c.is_appointed ? 'Appointed' : 'Pending'}
                                    </span>
                                    <Switch
                                        checked={c.is_appointed}
                                        onCheckedChange={() => toggleAppointed(c.id, c.is_appointed)}
                                        className="scale-90"
                                    />
                                </div>

                                <div className="flex items-center gap-1 border-l pl-4 border-border/50">
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
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editTarget ? "Edit Carrier" : "Add Carrier"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">Carrier Name</label>
                            <Input
                                value={formName}
                                onChange={(e) => { setFormName(e.target.value); setFormErrors({}); }}
                                placeholder="e.g. Mutual of Omaha"
                                className={formErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                                onKeyDown={(e) => { if (e.key === "Enter" && !saving) handleSave(); }}
                            />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">Agent Portal URL <span className="text-muted-foreground font-normal">(Optional)</span></label>
                            <Input
                                value={formUrl}
                                onChange={(e) => setFormUrl(e.target.value)}
                                placeholder="e.g. https://agents.mutualofomaha.com"
                                onKeyDown={(e) => { if (e.key === "Enter" && !saving) handleSave(); }}
                            />
                        </div>
                        <div className="flex items-center justify-between bg-accent/30 p-3 rounded-lg border mt-2">
                            <div className="space-y-0.5">
                                <label className="text-sm font-medium text-foreground block">Appointed Status</label>
                                <span className="text-xs text-muted-foreground">Are you currently appointed to sell for them?</span>
                            </div>
                            <Switch checked={formAppointed} onCheckedChange={setFormAppointed} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving} className="gap-2">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {editTarget ? "Save Changes" : "Add Carrier"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => (!o && !saving) && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Carrier</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to remove <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span>?
                            This will remove the carrier from your settings.
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
