import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Target, TrendingUp, Plus, Loader2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

interface Goal {
    id: string;
    metric: string;
    target_value: number;
    period: string;
    updatedAt: Date;
}

const COMMON_METRICS = [
    "Dials",
    "Conversations",
    "Appointments Set",
    "Appointments Kept",
    "Presentations",
    "Policies Sold",
    "Premium Issued"
];

const PERIODS = ["Daily", "Weekly", "Monthly", "Quarterly", "Annually"];

const GoalSetting: React.FC = () => {
    const [goals, setGoals] = useState<Goal[]>([]);
    const [loading, setLoading] = useState(true);

    const [addOpen, setAddOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<Goal | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Goal | null>(null);

    const [formMetric, setFormMetric] = useState("Dials");
    const [formTargetVal, setFormTargetVal] = useState<string>("100");
    const [formPeriod, setFormPeriod] = useState("Daily");
    const [formErrors, setFormErrors] = useState<{ metric?: boolean; val?: boolean }>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchGoals();
    }, []);

    const fetchGoals = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('goals')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted: Goal[] = (data || []).map(d => ({
                id: d.id,
                metric: d.metric,
                target_value: d.target_value,
                period: d.period,
                updatedAt: new Date(d.updated_at),
            }));
            setGoals(formatted);
        } catch (error) {
            console.error("Error fetching goals:", error);
            toast({ title: "Error loading goals", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const openAdd = () => {
        setFormMetric("Dials");
        setFormTargetVal("100");
        setFormPeriod("Daily");
        setFormErrors({});
        setEditTarget(null);
        setAddOpen(true);
    };

    const openEdit = (g: Goal) => {
        setFormMetric(g.metric);
        setFormTargetVal(g.target_value.toString());
        setFormPeriod(g.period);
        setFormErrors({});
        setEditTarget(g);
        setAddOpen(true);
    };

    const handleSave = async () => {
        const val = parseInt(formTargetVal, 10);
        const errors = {
            metric: !formMetric.trim(),
            val: isNaN(val) || val <= 0,
        };
        if (errors.metric || errors.val) {
            setFormErrors(errors);
            return;
        }

        try {
            setSaving(true);
            const payload = {
                metric: formMetric.trim(),
                target_value: val,
                period: formPeriod,
                updated_at: new Date().toISOString()
            };

            if (editTarget) {
                const { error } = await supabase.from('goals').update(payload).eq('id', editTarget.id);
                if (error) throw error;
                toast({ title: "Goal updated", className: "bg-success text-success-foreground border-success" });
            } else {
                const { error } = await supabase.from('goals').insert(payload);
                if (error) throw error;
                toast({ title: "Goal created", className: "bg-success text-success-foreground border-success" });
            }

            setAddOpen(false);
            fetchGoals();
        } catch (error) {
            toast({ title: "Failed to save goal", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            setSaving(true);
            const { error } = await supabase.from('goals').delete().eq('id', deleteTarget.id);
            if (error) throw error;

            setGoals(prev => prev.filter(g => g.id !== deleteTarget.id));
            toast({ title: "Goal deleted", className: "bg-success text-success-foreground border-success" });
        } catch (error) {
            toast({ title: "Failed to delete goal", variant: "destructive" });
        } finally {
            setSaving(false);
            setDeleteTarget(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-foreground">Goal Setting</h3>
                    <p className="text-sm text-muted-foreground">Set and track performance metrics for your agency</p>
                </div>
                <Button onClick={openAdd} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Goal
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading ? (
                    <div className="col-span-full flex justify-center p-12 bg-card rounded-xl border">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                ) : goals.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center p-12 text-center bg-card rounded-xl border border-dashed">
                        <Target className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                        <p className="text-foreground font-medium text-lg">No goals set yet</p>
                        <p className="text-sm text-muted-foreground mb-4">Create your first goal to start tracking progress.</p>
                        <Button size="sm" onClick={openAdd} className="gap-2">
                            <Plus className="w-4 h-4" /> Create Goal
                        </Button>
                    </div>
                ) : (
                    goals.map(g => (
                        <div key={g.id} className="bg-card rounded-xl border p-5 flex flex-col hover:border-primary/50 sidebar-transition relative group">
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm shadow-sm" onClick={() => openEdit(g)}>
                                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 bg-background/80 backdrop-blur-sm shadow-sm hover:text-destructive" onClick={() => setDeleteTarget(g)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>

                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                    <TrendingUp className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground font-medium tracking-wide uppercase">{g.period}</p>
                                    <h4 className="font-bold text-foreground truncate max-w-[150px]">{g.metric}</h4>
                                </div>
                            </div>

                            <div className="mt-auto">
                                <div className="flex items-end gap-2">
                                    <span className="text-3xl font-black tracking-tight text-foreground">{g.target_value.toLocaleString()}</span>
                                    <span className="text-sm text-muted-foreground mb-1 font-medium">Target</span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editTarget ? "Edit Goal" : "Add Goal"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-sm font-medium text-foreground mb-1.5 block">Metric Name</label>
                            <Input
                                value={formMetric}
                                onChange={(e) => { setFormMetric(e.target.value); setFormErrors(prev => ({ ...prev, metric: false })); }}
                                placeholder="e.g. Dials, Appointments"
                                className={formErrors.metric ? "border-destructive focus-visible:ring-destructive" : ""}
                                list="metrics-list"
                            />
                            <datalist id="metrics-list">
                                {COMMON_METRICS.map(m => <option key={m} value={m} />)}
                            </datalist>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1.5 block">Target Value</label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={formTargetVal}
                                    onChange={(e) => { setFormTargetVal(e.target.value); setFormErrors(prev => ({ ...prev, val: false })); }}
                                    className={formErrors.val ? "border-destructive focus-visible:ring-destructive" : ""}
                                    onKeyDown={(e) => { if (e.key === "Enter" && !saving) handleSave(); }}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1.5 block">Time Period</label>
                                <Select value={formPeriod} onValueChange={setFormPeriod}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PERIODS.map(p => (
                                            <SelectItem key={p} value={p}>{p}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} disabled={saving} className="gap-2">
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {editTarget ? "Save Changes" : "Create Goal"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => (!o && !saving) && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Goal</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this <span className="font-semibold text-foreground">{deleteTarget?.metric}</span> goal? This tracking metric will be removed instantly.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving}>
                            Delete Goal
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default GoalSetting;
