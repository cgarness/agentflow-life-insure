import React, { useState, useEffect, useCallback, useRef } from "react";
import { dispositionsSupabaseApi as dispositionsApi } from "@/lib/supabase-dispositions";
import { Disposition } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import {
  GripVertical, Plus, Pencil, Trash2, Info, BarChart3, TrendingUp,
  TrendingDown, Phone, Calendar, FileText, Zap, X, Check, AlertTriangle,
  Users, ShieldBan, Lock,
} from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import type { CampaignAction } from "@/lib/types";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const PRESET_COLORS = [
  { name: "Red", hex: "#EF4444" },
  { name: "Orange", hex: "#F97316" },
  { name: "Yellow", hex: "#EAB308" },
  { name: "Green", hex: "#22C55E" },
  { name: "Blue", hex: "#3B82F6" },
  { name: "Purple", hex: "#8B5CF6" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Gray", hex: "#6B7280" },
  { name: "Teal", hex: "#14B8A6" },
];

const MOCK_AUTOMATIONS = [
  { id: "auto1", name: "Send Welcome Email" },
  { id: "auto2", name: "Assign to Follow-Up Queue" },
  { id: "auto3", name: "Notify Team Leader" },
  { id: "auto4", name: "Create Appointment Task" },
];

interface FormState {
  name: string;
  color: string;
  requireNotes: boolean;
  minNoteChars: number;
  callbackScheduler: boolean;
  appointmentScheduler: boolean;
  automationTrigger: boolean;
  automationId: string;
  automationName: string;
  campaignAction: CampaignAction;
  dncAutoAdd: boolean;
}

const emptyForm: FormState = {
  name: "",
  color: "#3B82F6",
  requireNotes: false,
  minNoteChars: 10,
  callbackScheduler: false,
  appointmentScheduler: false,
  automationTrigger: false,
  automationId: "",
  automationName: "",
  campaignAction: "none",
  dncAutoAdd: false,
};

const DispositionsManager: React.FC = () => {
  const { organizationId } = useOrganization();
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Disposition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState("Last 30 days");
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof dispositionsApi.getAnalytics>> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Drag state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await dispositionsApi.getAll();
      setDispositions(data);
    } catch {
      toast({ title: "Error loading dispositions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const data = await dispositionsApi.getAnalytics(analyticsPeriod);
      setAnalytics(data);
    } catch {
      // silent
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsPeriod]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (d: Disposition) => {
    setEditingId(d.id);
    setForm({
      name: d.name,
      color: d.color,
      requireNotes: d.requireNotes,
      minNoteChars: d.minNoteChars || 10,
      callbackScheduler: d.callbackScheduler,
      appointmentScheduler: d.appointmentScheduler,
      automationTrigger: d.automationTrigger,
      automationId: d.automationId || "",
      automationName: d.automationName || "",
      campaignAction: d.campaignAction || "none",
      dncAutoAdd: d.dncAutoAdd || false,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!form.color) {
      toast({ title: "Please select a color", variant: "destructive" });
      return;
    }
    if (form.automationTrigger && !form.automationId) {
      toast({ title: "Please select an automation", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await dispositionsApi.update(editingId, {
          name: form.name,
          color: form.color,
          requireNotes: form.requireNotes,
          minNoteChars: form.requireNotes ? form.minNoteChars : 0,
          callbackScheduler: form.callbackScheduler,
          appointmentScheduler: form.appointmentScheduler,
          automationTrigger: form.automationTrigger,
          automationId: form.automationTrigger ? form.automationId : undefined,
          automationName: form.automationTrigger ? form.automationName : undefined,
          campaignAction: form.campaignAction,
          dncAutoAdd: form.dncAutoAdd,
        });
        toast({ title: "Disposition updated" });
      } else {
        await dispositionsApi.create({
          name: form.name,
          color: form.color,
          isLocked: false,
          requireNotes: form.requireNotes,
          minNoteChars: form.requireNotes ? form.minNoteChars : 0,
          callbackScheduler: form.callbackScheduler,
          appointmentScheduler: form.appointmentScheduler,
          automationTrigger: form.automationTrigger,
          automationId: form.automationTrigger ? form.automationId : undefined,
          automationName: form.automationTrigger ? form.automationName : undefined,
          campaignAction: form.campaignAction,
          dncAutoAdd: form.dncAutoAdd,
          order: dispositions.length + 1,
        }, organizationId);
        toast({ title: "Disposition created" });
      }
      setShowModal(false);
      load();
      loadAnalytics();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: e.message || "Error saving", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await dispositionsApi.delete(deleteTarget.id);
      toast({ title: `"${deleteTarget.name}" deleted` });
      setDeleteTarget(null);
      load();
      loadAnalytics();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast({ title: e.message || "Error deleting", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  // Drag handlers
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setOverIdx(idx);
  };
  const handleDrop = async (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const reordered = [...dispositions];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setDispositions(reordered);
    setDragIdx(null);
    setOverIdx(null);
    try {
      await dispositionsApi.reorder(reordered.map(d => d.id));
      toast({ title: "Order saved" });
    } catch {
      toast({ title: "Error saving order", variant: "destructive" });
      load();
    }
  };

  const isEditingLocked = editingId
    ? dispositions.find(d => d.id === editingId)?.isLocked ?? false
    : false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Dispositions Manager</h3>
          <p className="text-sm text-muted-foreground">Manage call outcome categories used after every call.</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-foreground/80">
          The order here determines what agents see after every call in the dialer. Numbers 1–9 match keyboard shortcuts during calls.
        </p>
      </div>

      {/* Disposition list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 rounded-lg bg-accent/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-card rounded-xl border overflow-hidden">
          {dispositions.map((d, idx) => (
            <div
              key={d.id}
              {...(!d.isLocked && {
                draggable: true,
                onDragStart: () => handleDragStart(idx),
                onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
                onDrop: () => handleDrop(idx),
                onDragEnd: () => { setDragIdx(null); setOverIdx(null); },
              })}
              className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${
                overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
              } ${dragIdx === idx ? "opacity-50" : ""}`}
            >
              <GripVertical className={`w-4 h-4 text-muted-foreground shrink-0 ${d.isLocked ? "cursor-default opacity-30" : "cursor-grab"}`} />
              <span className="w-6 h-6 rounded bg-muted text-muted-foreground text-xs font-bold flex items-center justify-center shrink-0">
                {idx + 1}
              </span>
              <span
                className="w-4 h-4 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: d.color }}
              />
              <span className="flex-1 text-sm font-medium text-foreground flex items-center gap-1.5">
                {d.name}
                {d.isLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
              </span>

              <div className="flex items-center gap-1.5 flex-wrap">
                {d.requireNotes && (
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <FileText className="w-2.5 h-2.5" /> Required Notes
                  </span>
                )}
                {d.callbackScheduler && (
                  <span className="text-[10px] bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <Calendar className="w-2.5 h-2.5" /> Callback Scheduler
                  </span>
                )}
                {d.appointmentScheduler && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <Calendar className="w-2.5 h-2.5" /> Appointment Scheduler
                  </span>
                )}
                {d.automationTrigger && d.automationName && (
                  <span className="text-[10px] bg-yellow-500/10 text-yellow-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <Zap className="w-2.5 h-2.5" /> {d.automationName}
                  </span>
                )}
                {d.campaignAction && d.campaignAction !== 'none' && (
                  <span className="text-[10px] bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <Users className="w-2.5 h-2.5" /> {d.campaignAction === 'remove_from_queue' ? 'Remove Queue' : 'Remove Campaign'}
                  </span>
                )}
                {d.dncAutoAdd && (
                  <span className="text-[10px] bg-red-500/10 text-red-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
                    <ShieldBan className="w-2.5 h-2.5" /> Auto-DNC
                  </span>
                )}
              </div>

              <button
                onClick={() => openEdit(d)}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => !d.isLocked && setDeleteTarget(d)}
                      disabled={d.isLocked}
                      className={`p-1.5 rounded-md transition-colors ${
                        d.isLocked
                          ? "opacity-40 cursor-not-allowed pointer-events-none text-muted-foreground"
                          : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      }`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  {d.isLocked && (
                    <TooltipContent>
                      <p>Locked dispositions cannot be deleted</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      <Button onClick={openAdd} variant="outline" className="w-full border-dashed">
        <Plus className="w-4 h-4 mr-2" /> Add Disposition
      </Button>

      {/* Analytics */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Disposition Analytics
            </h4>
            <p className="text-xs text-muted-foreground">{analyticsPeriod}</p>
          </div>
          <select
            value={analyticsPeriod}
            onChange={e => setAnalyticsPeriod(e.target.value)}
            className="h-8 px-2 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50"
          >
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
            <option>All Time</option>
          </select>
        </div>

        {analyticsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-20 rounded-lg bg-accent/50 animate-pulse" />)}
          </div>
        ) : analytics && analytics.totalDispositioned > 0 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Dispositioned", value: analytics.totalDispositioned.toLocaleString() },
                { label: "Most Used", value: analytics.mostUsed },
                { label: "Positive Outcome Rate", value: analytics.positiveRate },
                { label: "Callback Rate", value: analytics.callbackRate },
              ].map(s => (
                <div key={s.label} className="bg-accent/50 rounded-lg p-3">
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold text-foreground mt-0.5 truncate">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="bg-card rounded-xl border divide-y">
              {analytics.breakdown.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                  <span className="text-sm font-medium text-foreground flex-1">{b.name}</span>
                  <span className="text-sm font-mono text-foreground w-12 text-right">{b.count}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">{b.percent}%</span>
                  <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${b.percent}%`, backgroundColor: b.color }}
                    />
                  </div>
                  <span className={`text-xs flex items-center gap-0.5 w-12 justify-end ${b.trend > 0 ? "text-green-600" : b.trend < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                    {b.trend > 0 ? <TrendingUp className="w-3 h-3" /> : b.trend < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                    {b.trend > 0 ? "+" : ""}{b.trend}%
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="bg-accent/50 rounded-xl p-8 text-center">
            <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h4 className="font-medium text-foreground mb-1">No call data yet</h4>
            <p className="text-sm text-muted-foreground">Disposition analytics will appear after your team starts making calls.</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Disposition" : "Add Disposition"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the disposition settings." : "Create a new call disposition."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* Name */}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Disposition Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, 30) }))}
                placeholder="e.g., Appointment Set"
                disabled={isEditingLocked}
                maxLength={30}
              />
              <p className="text-xs text-muted-foreground mt-1 text-right">{form.name.length}/30</p>
              {isEditingLocked && <p className="text-xs text-muted-foreground">This disposition is locked and cannot be renamed.</p>}
            </div>

            {/* Color */}
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Color *</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c.hex}
                    onClick={() => setForm(f => ({ ...f, color: c.hex }))}
                    className={`w-8 h-8 rounded-lg border-2 transition-all ${
                      form.color === c.hex ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex }}
                    title={c.name}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="w-8 h-8 rounded-lg border shrink-0"
                  style={{ backgroundColor: form.color }}
                />
                <Input
                  value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  placeholder="#3B82F6"
                  className="font-mono text-sm"
                />
              </div>
            </div>

            {/* Required Notes */}
            {!isEditingLocked && (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Required Notes
                    </p>
                    <p className="text-xs text-muted-foreground">Agent must type a note before advancing.</p>
                  </div>
                  <Switch
                    checked={form.requireNotes}
                    onCheckedChange={v => setForm(f => ({ ...f, requireNotes: v }))}
                  />
                </div>
                {form.requireNotes && (
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">Minimum characters</label>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={form.minNoteChars}
                      onChange={e => setForm(f => ({ ...f, minNoteChars: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-24"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Callback Scheduler */}
            {!isEditingLocked && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Callback Scheduler
                    </p>
                    <p className="text-xs text-muted-foreground">Opens date/time picker for a following call.</p>
                  </div>
                  <Switch
                    checked={form.callbackScheduler}
                    onCheckedChange={v => setForm(f => ({ ...f, callbackScheduler: v }))}
                  />
                </div>
              </div>
            )}

            {/* Appointment Scheduler */}
            {!isEditingLocked && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Appointment Scheduler
                    </p>
                    <p className="text-xs text-muted-foreground">Opens the appointment modal for a new sale/meeting.</p>
                  </div>
                  <Switch
                    checked={form.appointmentScheduler}
                    onCheckedChange={v => setForm(f => ({ ...f, appointmentScheduler: v }))}
                  />
                </div>
              </div>
            )}

            {/* Automation Trigger */}
            {!isEditingLocked && (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" /> Automation Trigger
                    </p>
                    <p className="text-xs text-muted-foreground">Trigger an automation when this disposition is selected.</p>
                  </div>
                  <Switch
                    checked={form.automationTrigger}
                    onCheckedChange={v => setForm(f => ({ ...f, automationTrigger: v, automationId: "", automationName: "" }))}
                  />
                </div>
                {form.automationTrigger && (
                  <select
                    value={form.automationId}
                    onChange={e => {
                      const auto = MOCK_AUTOMATIONS.find(a => a.id === e.target.value);
                      setForm(f => ({ ...f, automationId: e.target.value, automationName: auto?.name || "" }));
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">Select automation...</option>
                    {MOCK_AUTOMATIONS.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Campaign Action */}
            <div className="rounded-lg border p-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Campaign Action
                </p>
                <p className="text-xs text-muted-foreground">What happens to the lead in the campaign after this disposition.</p>
              </div>
              <select
                value={form.campaignAction}
                onChange={e => setForm(f => ({ ...f, campaignAction: e.target.value as CampaignAction }))}
                className="w-full h-9 px-3 rounded-lg bg-accent text-sm text-foreground border-0 focus:ring-2 focus:ring-primary/50"
              >
                <option value="none">No Action</option>
                <option value="remove_from_queue">Remove from Queue</option>
                <option value="remove_from_campaign">Remove from Campaign</option>
              </select>
              {form.campaignAction === "remove_from_queue" && (
                <p className="text-[11px] text-muted-foreground">Skips this lead for the rest of today's session but keeps them in the campaign.</p>
              )}
              {form.campaignAction === "remove_from_campaign" && (
                <p className="text-[11px] text-muted-foreground">Permanently removes this lead from the campaign — they won't appear in future queue pulls.</p>
              )}
            </div>

            {/* Auto-Add to DNC */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex-1 pr-4">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <ShieldBan className="w-3.5 h-3.5" /> Auto-Add to DNC
                  </p>
                  <p className="text-xs text-muted-foreground">Automatically adds the lead's phone number to the Do Not Call list when this disposition is selected.</p>
                </div>
                <Switch
                  checked={form.dncAutoAdd}
                  onCheckedChange={v => setForm(f => ({ ...f, dncAutoAdd: v }))}
                />
              </div>
            </div>

          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingId ? "Save Changes" : "Save Disposition"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Delete "{deleteTarget?.name}"?
            </DialogTitle>
            <DialogDescription>
              Used on {deleteTarget?.usageCount || 0} calls. Existing calls keep this disposition but it will not be available for new calls.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DispositionsManager;
