import React, { useState, useEffect, useCallback } from "react";
import { pipelineApi, customFieldsApi, leadSourcesApi, healthStatusesApi } from "@/lib/mock-api";
import { PipelineStage, CustomField, LeadSource, HealthStatus } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import {
  GripVertical, Plus, Pencil, Trash2, X, Check, Info,
  CheckCircle2, MinusCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

const TABS = ["Pipeline Stages", "Custom Fields", "Lead Sources", "Health Statuses"];

// ==================== PIPELINE STAGES TAB ====================

interface StageFormState {
  name: string;
  color: string;
  isPositive: boolean;
}
const emptyStageForm: StageFormState = { name: "", color: "#3B82F6", isPositive: false };

const StageList: React.FC<{
  title: string;
  description: string;
  pipelineType: "lead" | "recruit";
  stages: PipelineStage[];
  onReload: () => void;
  lockedPositiveId?: string;
}> = ({ title, description, pipelineType, stages, onReload, lockedPositiveId }) => {
  const [items, setItems] = useState(stages);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StageFormState>(emptyStageForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PipelineStage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  useEffect(() => { setItems(stages); setOrderChanged(false); }, [stages]);

  const openAdd = () => { setEditingId(null); setForm(emptyStageForm); setShowModal(true); };
  const openEdit = (s: PipelineStage) => {
    setEditingId(s.id);
    setForm({ name: s.name, color: s.color, isPositive: s.isPositive });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editingId) {
        await pipelineApi.updateStage(editingId, pipelineType, {
          name: form.name, color: form.color,
          isPositive: editingId === lockedPositiveId ? true : form.isPositive,
        });
        toast({ title: `${pipelineType === "lead" ? "Lead" : "Recruit"} stage updated` });
      } else {
        await pipelineApi.createStage({
          name: form.name, color: form.color, isPositive: form.isPositive,
          isDefault: false, order: items.length + 1, pipelineType,
        });
        toast({ title: `${pipelineType === "lead" ? "Lead" : "Recruit"} stage created` });
      }
      setShowModal(false);
      onReload();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await pipelineApi.deleteStage(deleteTarget.id, pipelineType);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      onReload();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally { setDeleting(false); }
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const reordered = [...items];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setItems(reordered);
    setDragIdx(null);
    setOverIdx(null);
    setOrderChanged(true);
  };

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await pipelineApi.reorderStages(items.map(s => s.id), pipelineType);
      toast({ title: "Stage order saved" });
      setOrderChanged(false);
      onReload();
    } catch { toast({ title: "Error saving order", variant: "destructive" }); }
    finally { setSavingOrder(false); }
  };

  const isEditingDefault = editingId ? items.find(s => s.id === editingId)?.isDefault : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add {pipelineType === "lead" ? "Lead" : "Recruit"} Stage
        </Button>
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        {items.map((s, idx) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${
              overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
            } ${dragIdx === idx ? "opacity-50" : ""}`}
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
            <span className="w-4 h-4 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: s.color }} />
            <span className="flex-1 text-sm font-medium text-foreground">{s.name}</span>

            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={s.isPositive}
                        disabled={s.id === lockedPositiveId}
                        onCheckedChange={async (checked) => {
                          try {
                            await pipelineApi.updateStage(s.id, pipelineType, { isPositive: checked });
                            onReload();
                          } catch {}
                        }}
                        className="data-[state=checked]:bg-green-500"
                      />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">Positive</span>
                    </div>
                  </TooltipTrigger>
                  {s.id === lockedPositiveId && <TooltipContent><p>This stage is always a positive outcome</p></TooltipContent>}
                </Tooltip>
              </TooltipProvider>
            </div>

            {s.isDefault && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">Default</span>}

            <button onClick={() => openEdit(s)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => !s.isDefault && setDeleteTarget(s)}
                    disabled={s.isDefault}
                    className={`p-1.5 rounded-md transition-colors ${s.isDefault ? "text-muted-foreground/30 cursor-not-allowed" : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                {s.isDefault && <TooltipContent><p>Default stages cannot be deleted</p></TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          </div>
        ))}
      </div>

      {orderChanged && (
        <Button onClick={saveOrder} disabled={savingOrder} className="w-full">
          {savingOrder ? "Saving..." : "Save Order"}
        </Button>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Stage" : "Add Stage"}</DialogTitle>
            <DialogDescription>{editingId ? "Update stage settings." : "Create a new pipeline stage."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Stage Name *</label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, 30) }))}
                placeholder="e.g., Qualified"
                disabled={!!isEditingDefault}
                maxLength={30}
              />
              <div className="flex justify-between mt-1">
                {isEditingDefault && <p className="text-xs text-muted-foreground">(Default — locked)</p>}
                <p className="text-xs text-muted-foreground ml-auto">{form.name.length}/30</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Color *</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map(c => (
                  <button key={c.hex} onClick={() => setForm(f => ({ ...f, color: c.hex }))}
                    className={`w-8 h-8 rounded-lg border-2 transition-all ${form.color === c.hex ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c.hex }} title={c.name} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded border border-black/10" style={{ backgroundColor: form.color }} />
                <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#hex" className="flex-1 font-mono text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Positive Outcome</p>
                <p className="text-xs text-muted-foreground">Count this stage as a successful outcome in reports</p>
              </div>
              <Switch
                checked={editingId === lockedPositiveId ? true : form.isPositive}
                disabled={editingId === lockedPositiveId}
                onCheckedChange={v => setForm(f => ({ ...f, isPositive: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Save Stage"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              {Math.floor(Math.random() * 20)} leads are currently in this stage. They will become Unassigned if you proceed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting..." : "Delete Stage"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const PipelineStagesTab: React.FC = () => {
  const [leadStages, setLeadStages] = useState<PipelineStage[]>([]);
  const [recruitStages, setRecruitStages] = useState<PipelineStage[]>([]);

  const loadLead = useCallback(async () => { setLeadStages(await pipelineApi.getLeadStages()); }, []);
  const loadRecruit = useCallback(async () => { setRecruitStages(await pipelineApi.getRecruitStages()); }, []);

  useEffect(() => { loadLead(); loadRecruit(); }, [loadLead, loadRecruit]);

  const leadLockedPositiveId = leadStages.find(s => s.name === "Closed Won")?.id;
  const recruitLockedPositiveId = recruitStages.find(s => s.name === "Licensed & Onboarding")?.id;

  return (
    <div className="space-y-8">
      <StageList
        title="Lead Stages"
        description="Manage the status options that appear on lead records and the Kanban board."
        pipelineType="lead"
        stages={leadStages}
        onReload={loadLead}
        lockedPositiveId={leadLockedPositiveId}
      />
      <div className="border-t" />
      <StageList
        title="Recruit Stages"
        description="Manage the pipeline stages for your recruit Kanban board."
        pipelineType="recruit"
        stages={recruitStages}
        onReload={loadRecruit}
        lockedPositiveId={recruitLockedPositiveId}
      />
    </div>
  );
};

// ==================== CUSTOM FIELDS TAB ====================

interface FieldFormState {
  name: string;
  type: "Text" | "Number" | "Date" | "Dropdown";
  appliesTo: ("Leads" | "Clients" | "Recruits")[];
  required: boolean;
  defaultValue: string;
  dropdownOptions: string[];
}
const emptyFieldForm: FieldFormState = { name: "", type: "Text", appliesTo: [], required: false, defaultValue: "", dropdownOptions: ["", ""] };

const TYPE_BADGE_COLORS: Record<string, string> = {
  Text: "bg-muted text-muted-foreground",
  Number: "bg-blue-500/10 text-blue-500",
  Date: "bg-purple-500/10 text-purple-500",
  Dropdown: "bg-teal-500/10 text-teal-500",
};

const CustomFieldsTab: React.FC = () => {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FieldFormState>(emptyFieldForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<CustomField | null>(null);

  const load = useCallback(async () => { setFields(await customFieldsApi.getAll()); }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditingId(null); setForm(emptyFieldForm); setShowModal(true); };
  const openEdit = (f: CustomField) => {
    setEditingId(f.id);
    setForm({
      name: f.name, type: f.type, appliesTo: [...f.appliesTo],
      required: f.required, defaultValue: f.defaultValue || "",
      dropdownOptions: f.dropdownOptions?.length ? [...f.dropdownOptions] : ["", ""],
    });
    setShowModal(true);
  };

  const toggleApplies = (val: "Leads" | "Clients" | "Recruits") => {
    setForm(f => ({
      ...f,
      appliesTo: f.appliesTo.includes(val) ? f.appliesTo.filter(v => v !== val) : [...f.appliesTo, val],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (form.appliesTo.length === 0) { toast({ title: "Select at least one 'Applies To'", variant: "destructive" }); return; }
    if (form.type === "Dropdown") {
      const validOpts = form.dropdownOptions.filter(o => o.trim());
      if (validOpts.length < 2) { toast({ title: "Dropdown requires at least 2 options", variant: "destructive" }); return; }
    }
    setSaving(true);
    try {
      const data = {
        name: form.name, type: form.type, appliesTo: form.appliesTo, required: form.required, active: true,
        defaultValue: ["Text", "Number"].includes(form.type) ? form.defaultValue : undefined,
        dropdownOptions: form.type === "Dropdown" ? form.dropdownOptions.filter(o => o.trim()) : undefined,
      };
      if (editingId) {
        await customFieldsApi.update(editingId, data);
        toast({ title: "Custom field updated" });
      } else {
        await customFieldsApi.create(data);
        toast({ title: "Custom field created" });
      }
      setShowModal(false);
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await customFieldsApi.delete(deleteTarget.id);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setDeleting(false); }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await customFieldsApi.update(deactivateTarget.id, { active: false });
      toast({ title: `${deactivateTarget.name} deactivated` });
      setDeactivateTarget(null);
      load();
    } catch {}
  };

  const handleToggleActive = async (f: CustomField) => {
    if (f.active) {
      setDeactivateTarget(f);
    } else {
      await customFieldsApi.update(f.id, { active: true });
      toast({ title: `${f.name} activated` });
      load();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-semibold text-foreground">Custom Fields</h4>
          <p className="text-sm text-muted-foreground">Create additional fields that appear on contact records for your agents to fill in.</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Custom Field</Button>
      </div>

      {fields.length === 0 ? (
        <div className="bg-accent/50 rounded-xl p-8 text-center">
          <Info className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h4 className="font-medium text-foreground mb-1">No custom fields yet</h4>
          <p className="text-sm text-muted-foreground mb-4">Add your first custom field to capture information specific to your agency.</p>
          <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Custom Field</Button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border overflow-hidden">
          <div className="grid grid-cols-[1fr_80px_120px_70px_60px_70px] gap-2 px-4 py-2 border-b text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <span>Field Name</span><span>Type</span><span>Applies To</span><span>Required</span><span>Active</span><span></span>
          </div>
          {fields.map(f => (
            <div key={f.id} className={`grid grid-cols-[1fr_80px_120px_70px_60px_70px] gap-2 px-4 py-3 border-b last:border-b-0 items-center ${!f.active ? "opacity-50" : ""}`}>
              <span className="text-sm font-medium text-foreground truncate">{f.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium w-fit ${TYPE_BADGE_COLORS[f.type]}`}>{f.type}</span>
              <span className="text-xs text-muted-foreground">{f.appliesTo.join(", ")}</span>
              <span>{f.required ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <MinusCircle className="w-4 h-4 text-muted-foreground/30" />}</span>
              <Switch checked={f.active} onCheckedChange={() => handleToggleActive(f)} />
              <div className="flex gap-1">
                <button onClick={() => openEdit(f)} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => setDeleteTarget(f)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Field Name *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, 40) }))} placeholder="e.g., Policy Preference" maxLength={40} />
              <p className="text-xs text-muted-foreground mt-1 text-right">{form.name.length}/40</p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Field Type</label>
              <Select value={form.type} onValueChange={(v: any) => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Text", "Number", "Date", "Dropdown"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Applies To *</label>
              <div className="flex gap-4">
                {(["Leads", "Clients", "Recruits"] as const).map(v => (
                  <label key={v} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <Checkbox checked={form.appliesTo.includes(v)} onCheckedChange={() => toggleApplies(v)} />
                    {v}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Required</p>
                <p className="text-xs text-muted-foreground">Agents must fill in this field before saving a contact</p>
              </div>
              <Switch checked={form.required} onCheckedChange={v => setForm(f => ({ ...f, required: v }))} />
            </div>
            {["Text", "Number"].includes(form.type) && (
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Default Value (optional)</label>
                <Input value={form.defaultValue} onChange={e => setForm(f => ({ ...f, defaultValue: e.target.value }))} placeholder="Default value" />
              </div>
            )}
            {form.type === "Dropdown" && (
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Dropdown Options (min 2)</label>
                <div className="space-y-2">
                  {form.dropdownOptions.map((opt, i) => (
                    <div key={i} className="flex gap-2">
                      <Input value={opt} onChange={e => {
                        const opts = [...form.dropdownOptions];
                        opts[i] = e.target.value;
                        setForm(f => ({ ...f, dropdownOptions: opts }));
                      }} placeholder={`Option ${i + 1}`} />
                      {form.dropdownOptions.length > 2 && (
                        <Button variant="ghost" size="icon" onClick={() => setForm(f => ({ ...f, dropdownOptions: f.dropdownOptions.filter((_, j) => j !== i) }))}>
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, dropdownOptions: [...f.dropdownOptions, ""] }))}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Option
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Save Field"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>This field has data on {deleteTarget?.usageCount || 0} contacts. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting..." : "Delete Field"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <Dialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate {deactivateTarget?.name}?</DialogTitle>
            <DialogDescription>It will be hidden from new contacts but existing data is preserved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
            <Button onClick={handleDeactivate}>Deactivate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ==================== LEAD SOURCES TAB ====================

const LeadSourcesTab: React.FC = () => {
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", color: "#3B82F6" });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LeadSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const load = useCallback(async () => { setSources(await leadSourcesApi.getAll()); setOrderChanged(false); }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditingId(null); setForm({ name: "", color: "#3B82F6" }); setShowModal(true); };
  const openEdit = (s: LeadSource) => { setEditingId(s.id); setForm({ name: s.name, color: s.color }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editingId) {
        await leadSourcesApi.update(editingId, { name: form.name, color: form.color });
        toast({ title: "Lead source updated" });
      } else {
        await leadSourcesApi.create({ name: form.name, color: form.color, active: true, order: sources.length + 1 });
        toast({ title: "Lead source created" });
      }
      setShowModal(false);
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.usageCount > 0 && reassignTo) {
        const result = await leadSourcesApi.reassignAndDelete(deleteTarget.id, reassignTo);
        const newName = sources.find(s => s.id === reassignTo)?.name || "";
        toast({ title: `Source deleted and ${result.reassigned} leads reassigned to ${newName}` });
      } else {
        await leadSourcesApi.delete(deleteTarget.id);
        toast({ title: `${deleteTarget.name} deleted` });
      }
      setDeleteTarget(null);
      setReassignTo("");
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setDeleting(false); }
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const reordered = [...sources];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setSources(reordered);
    setDragIdx(null);
    setOverIdx(null);
    setOrderChanged(true);
  };

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await leadSourcesApi.reorder(sources.map(s => s.id));
      toast({ title: "Source order saved" });
      setOrderChanged(false);
      load();
    } catch { toast({ title: "Error saving order", variant: "destructive" }); }
    finally { setSavingOrder(false); }
  };

  const handleToggleActive = async (s: LeadSource) => {
    await leadSourcesApi.update(s.id, { active: !s.active });
    toast({ title: `${s.name} ${s.active ? "deactivated" : "activated"}` });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-semibold text-foreground">Lead Sources</h4>
          <p className="text-sm text-muted-foreground">Manage the lead source options that appear when adding or importing contacts.</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Lead Source</Button>
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        {sources.map((s, idx) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${
              overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
            } ${dragIdx === idx ? "opacity-50" : ""} ${!s.active ? "opacity-50" : ""}`}
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
            <span className="w-4 h-4 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: s.color }} />
            <span className="flex-1 text-sm font-medium text-foreground">{s.name}</span>
            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">{s.usageCount} leads</span>
            <Switch checked={s.active} onCheckedChange={() => handleToggleActive(s)} />
            <button onClick={() => openEdit(s)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={() => { setDeleteTarget(s); setReassignTo(""); }} className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>

      {orderChanged && (
        <Button onClick={saveOrder} disabled={savingOrder} className="w-full">
          {savingOrder ? "Saving..." : "Save Order"}
        </Button>
      )}

      {/* Add/Edit */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Lead Source" : "Add Lead Source"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Source Name *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, 30) }))} placeholder="e.g., Webinar" maxLength={30} />
              <p className="text-xs text-muted-foreground mt-1 text-right">{form.name.length}/30</p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Color</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map(c => (
                  <button key={c.hex} onClick={() => setForm(f => ({ ...f, color: c.hex }))}
                    className={`w-8 h-8 rounded-lg border-2 transition-all ${form.color === c.hex ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c.hex }} title={c.name} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded border border-black/10" style={{ backgroundColor: form.color }} />
                <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#hex" className="flex-1 font-mono text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Save Source"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              {deleteTarget && deleteTarget.usageCount > 0
                ? `This source is assigned to ${deleteTarget.usageCount} leads. Before deleting you must reassign those leads.`
                : "This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && deleteTarget.usageCount > 0 && (
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Reassign all leads to:</label>
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger><SelectValue placeholder="Select source..." /></SelectTrigger>
                <SelectContent>
                  {sources.filter(s => s.id !== deleteTarget.id && s.active).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}
              disabled={deleting || (!!deleteTarget && deleteTarget.usageCount > 0 && !reassignTo)}>
              {deleting ? "Deleting..." : deleteTarget && deleteTarget.usageCount > 0 ? "Reassign and Delete" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ==================== HEALTH STATUSES TAB ====================

const HealthStatusesTab: React.FC = () => {
  const [statuses, setStatuses] = useState<HealthStatus[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", color: "#3B82F6", description: "" });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HealthStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const load = useCallback(async () => { setStatuses(await healthStatusesApi.getAll()); setOrderChanged(false); }, []);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditingId(null); setForm({ name: "", color: "#3B82F6", description: "" }); setShowModal(true); };
  const openEdit = (h: HealthStatus) => {
    setEditingId(h.id);
    setForm({ name: h.name, color: h.color, description: h.description });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editingId) {
        await healthStatusesApi.update(editingId, { name: form.name, color: form.color, description: form.description });
        toast({ title: "Health status updated" });
      } else {
        await healthStatusesApi.create({ name: form.name, color: form.color, description: form.description, isDefault: false, order: statuses.length + 1 });
        toast({ title: "Health status created" });
      }
      setShowModal(false);
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await healthStatusesApi.delete(deleteTarget.id);
      toast({ title: `${deleteTarget.name} deleted` });
      setDeleteTarget(null);
      load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setDeleting(false); }
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const reordered = [...statuses];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    setStatuses(reordered);
    setDragIdx(null);
    setOverIdx(null);
    setOrderChanged(true);
  };

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      await healthStatusesApi.reorder(statuses.map(h => h.id));
      toast({ title: "Health status order saved" });
      setOrderChanged(false);
      load();
    } catch { toast({ title: "Error saving order", variant: "destructive" }); }
    finally { setSavingOrder(false); }
  };

  const isEditingDefault = editingId ? statuses.find(h => h.id === editingId)?.isDefault : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-semibold text-foreground">Health Statuses</h4>
          <p className="text-sm text-muted-foreground">Manage the health classification options that appear on lead and client records.</p>
        </div>
        <Button onClick={openAdd} size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Health Status</Button>
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        {statuses.map((h, idx) => (
          <div
            key={h.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
            onDrop={() => handleDrop(idx)}
            onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${
              overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
            } ${dragIdx === idx ? "opacity-50" : ""}`}
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
            <span className="w-4 h-4 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: h.color }} />
            <span className="text-sm font-medium text-foreground">{h.name}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex-1 text-xs text-muted-foreground truncate max-w-[200px]">
                    {h.description.length > 50 ? h.description.slice(0, 50) + "…" : h.description}
                  </span>
                </TooltipTrigger>
                {h.description.length > 50 && <TooltipContent className="max-w-xs"><p>{h.description}</p></TooltipContent>}
              </Tooltip>
            </TooltipProvider>
            {h.isDefault && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">Default</span>}
            <button onClick={() => openEdit(h)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => !h.isDefault && setDeleteTarget(h)}
                    disabled={h.isDefault}
                    className={`p-1.5 rounded-md transition-colors ${h.isDefault ? "text-muted-foreground/30 cursor-not-allowed" : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                {h.isDefault && <TooltipContent><p>Default statuses cannot be deleted</p></TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          </div>
        ))}
      </div>

      {orderChanged && (
        <Button onClick={saveOrder} disabled={savingOrder} className="w-full">
          {savingOrder ? "Saving..." : "Save Order"}
        </Button>
      )}

      {/* Add/Edit */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Edit Health Status" : "Add Health Status"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Status Name *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value.slice(0, 30) }))}
                placeholder="e.g., Diabetic" disabled={!!isEditingDefault} maxLength={30} />
              <div className="flex justify-between mt-1">
                {isEditingDefault && <p className="text-xs text-muted-foreground">(Default — locked)</p>}
                <p className="text-xs text-muted-foreground ml-auto">{form.name.length}/30</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Color</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map(c => (
                  <button key={c.hex} onClick={() => setForm(f => ({ ...f, color: c.hex }))}
                    className={`w-8 h-8 rounded-lg border-2 transition-all ${form.color === c.hex ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
                    style={{ backgroundColor: c.hex }} title={c.name} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded border border-black/10" style={{ backgroundColor: form.color }} />
                <Input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="#hex" className="flex-1 font-mono text-sm" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Description</label>
              <p className="text-xs text-muted-foreground mb-1">Short description shown as a tooltip in contact records</p>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value.slice(0, 100) }))} placeholder="e.g., Excellent health, no major conditions" maxLength={100} />
              <p className="text-xs text-muted-foreground mt-1 text-right">{form.description.length}/100</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Save Status"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

const ContactManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Contact Management</h3>
        <p className="text-sm text-muted-foreground">Configure pipeline stages, custom fields, lead sources, and health statuses.</p>
      </div>

      {/* Tab bar */}
      <div className="border-b">
        <div className="flex gap-1">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === i
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {activeTab === i && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 0 && <PipelineStagesTab />}
      {activeTab === 1 && <CustomFieldsTab />}
      {activeTab === 2 && <LeadSourcesTab />}
      {activeTab === 3 && <HealthStatusesTab />}
    </div>
  );
};

export default ContactManagement;
