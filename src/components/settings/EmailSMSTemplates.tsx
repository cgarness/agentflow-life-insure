import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mail, MessageSquare, Plus, Loader2, Search, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface Template {
    id: string;
    name: string;
    type: 'email' | 'sms';
    subject: string | null;
    content: string;
    updatedAt: Date;
}

const EmailSMSTemplates: React.FC = () => {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterType, setFilterType] = useState<string>("all");

    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Template | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

    const [formName, setFormName] = useState("");
    const [formType, setFormType] = useState<'email' | 'sms'>('email');
    const [formSubject, setFormSubject] = useState("");
    const [formContent, setFormContent] = useState("");
    const [formErrors, setFormErrors] = useState<{ name?: boolean, content?: boolean }>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('message_templates')
                .select('*')
                .order('updated_at', { ascending: false });

            if (error) throw error;

            const formatted: Template[] = (data || []).map(d => ({
                id: d.id,
                name: d.name,
                type: d.type as 'email' | 'sms',
                subject: d.subject,
                content: d.content,
                updatedAt: new Date(d.updated_at),
            }));
            setTemplates(formatted);
        } catch (error) {
            console.error("Error fetching templates:", error);
            toast({ title: "Error loading templates", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setFormName("");
        setFormType("email");
        setFormSubject("");
        setFormContent("");
        setFormErrors({});
        setEditTarget(null);
        setAddOpen(true);
    };

    const openEdit = (t: Template) => {
        setFormName(t.name);
        setFormType(t.type);
        setFormSubject(t.subject || "");
        setFormContent(t.content);
        setFormErrors({});
        setEditTarget(t);
        setAddOpen(true);
    };

    const handleSave = async () => {
        const errors = {
            name: !formName.trim(),
            content: !formContent.trim(),
        };
        if (errors.name || errors.content) {
            setFormErrors(errors);
            return;
        }

        try {
            setSaving(true);
            const payload = {
                name: formName.trim(),
                type: formType,
                subject: formType === 'email' ? formSubject.trim() : null,
                content: formContent.trim(),
                updated_at: new Date().toISOString()
            };

            if (editTarget) {
                const { error } = await supabase.from('message_templates').update(payload).eq('id', editTarget.id);
                if (error) throw error;
                toast({ title: "Template updated", className: "bg-success text-success-foreground border-success" });
            } else {
                const { error } = await supabase.from('message_templates').insert(payload);
                if (error) throw error;
                toast({ title: "Template created", className: "bg-success text-success-foreground border-success" });
            }

            setAddOpen(false);
            fetchTemplates();
        } catch (error) {
            toast({ title: "Failed to save template", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            setSaving(true);
            const { error } = await supabase.from('message_templates').delete().eq('id', deleteTarget.id);
            if (error) throw error;

            setTemplates(prev => prev.filter(t => t.id !== deleteTarget.id));
            toast({ title: "Template deleted", className: "bg-success text-success-foreground border-success" });
        } catch (error) {
            toast({ title: "Failed to delete template", variant: "destructive" });
        } finally {
            setSaving(false);
            setDeleteTarget(null);
        }
    };

    const filtered = templates.filter(t => {
        const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
        const matchType = filterType === "all" || t.type === filterType;
        return matchSearch && matchType;
    });

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Email & SMS Templates</h3>
                    <p className="text-sm text-muted-foreground">Manage templates for automated and manual messaging</p>
                </div>
                <Button onClick={openAdd} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Template
                </Button>
            </div>

            <div className="flex items-center gap-3">
                <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search templates..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 bg-card"
                    />
                </div>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-36 bg-card">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="bg-card rounded-xl border divide-y overflow-hidden max-h-[600px] overflow-y-auto min-h-[400px]">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[300px] text-center p-6">
                        <Mail className="w-10 h-10 text-muted-foreground mb-3" />
                        <p className="text-foreground font-medium">No templates found</p>
                        <p className="text-sm text-muted-foreground mb-4">You haven't added any templates matching your criteria.</p>
                        <Button size="sm" onClick={openAdd} className="gap-2">
                            <Plus className="w-4 h-4" /> Add Template
                        </Button>
                    </div>
                ) : (
                    filtered.map(t => (
                        <div key={t.id} className="flex items-center justify-between p-4 hover:bg-accent/50 sidebar-transition">
                            <div className="flex items-start gap-3 flex-1 min-w-0 pr-4">
                                <div className={`mt-1 p-2 rounded-lg shrink-0 ${t.type === 'email' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success'}`}>
                                    {t.type === 'email' ? <Mail className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <h4 className="font-semibold text-foreground truncate">{t.name}</h4>
                                        <Badge variant={t.type === 'email' ? 'default' : 'secondary'} className="uppercase text-[10px] tracking-wider font-bold">
                                            {t.type}
                                        </Badge>
                                    </div>
                                    {t.type === 'email' && t.subject && (
                                        <p className="text-xs text-muted-foreground truncate mb-1"><span className="font-medium text-foreground/80">Subj:</span> {t.subject}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground line-clamp-1 bg-accent/30 p-1.5 rounded font-mono mt-1">
                                        {t.content}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <Button variant="ghost" size="icon" onClick={() => openEdit(t)} title="Edit Template">
                                    <Pencil className="w-4 h-4 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(t)} title="Delete Template" className="hover:text-destructive hover:bg-destructive/10">
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Add/Edit Dialog */}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{editTarget ? "Edit Template" : "Add Template"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="grid grid-cols-4 gap-4">
                            <div className="col-span-3">
                                <label className="text-sm font-medium text-foreground mb-1.5 block">Template Name</label>
                                <Input
                                    value={formName}
                                    onChange={(e) => { setFormName(e.target.value); setFormErrors(prev => ({ ...prev, name: false })); }}
                                    placeholder="e.g. Initial Follow Up"
                                    className={formErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                                />
                            </div>
                            <div className="col-span-1">
                                <label className="text-sm font-medium text-foreground mb-1.5 block">Type</label>
                                <Select value={formType} onValueChange={(v) => setFormType(v as 'email' | 'sms')} disabled={!!editTarget}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="email">Email</SelectItem>
                                        <SelectItem value="sms">SMS</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {formType === 'email' && (
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1.5 block">Subject Line</label>
                                <Input
                                    value={formSubject}
                                    onChange={(e) => setFormSubject(e.target.value)}
                                    placeholder="e.g. Important Info Regarding Your Request"
                                />
                            </div>
                        )}

                        <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">Message Content</label>
                            <textarea
                                value={formContent}
                                onChange={(e) => { setFormContent(e.target.value); setFormErrors(prev => ({ ...prev, content: false })); }}
                                placeholder={formType === 'email' ? "Type your email body here..." : "Type your text message here..."}
                                className={`flex w-full rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus:ring-1 focus:ring-primary h-40 resize-none ${formErrors.content ? "border-destructive focus-visible:ring-destructive" : "border-input"}`}
                            />
                            <p className="text-xs text-muted-foreground mt-1.5">You can use merge fields like {'{{contact_first_name}}'} or {'{{agent_name}}'}</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving} className="gap-2">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {editTarget ? "Save Changes" : "Create Template"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Dialog */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => (!o && !saving) && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Template</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <span className="font-semibold text-foreground">"{deleteTarget?.name}"</span>? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving}>
                            Delete Template
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default EmailSMSTemplates;
