import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  pipelineSupabaseApi as pipelineApi,
  customFieldsSupabaseApi as customFieldsApi,
  leadSourcesSupabaseApi as leadSourcesApi,
  healthStatusesSupabaseApi as healthStatusesApi
} from "@/lib/supabase-settings";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { PipelineStage, CustomField, LeadSource, HealthStatus, ContactManagementSettings } from "@/lib/types";
import { toast } from "@/hooks/use-toast";
import {
  GripVertical, Plus, Pencil, Trash2, X, Check, Info,
  CheckCircle2, MinusCircle, Lock, AlertTriangle, Flame,
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

const TABS = ["Pipeline Stages", "Custom Fields", "Lead Sources", "Health Statuses", "Duplicate Detection", "Required Fields", "Assignment Rules", "Display Settings"];

// ==================== PIPELINE STAGES TAB ====================

interface StageFormState {
  name: string;
  color: string;
  isPositive: boolean;
  convertToClient: boolean;
}
const emptyStageForm: StageFormState = { name: "", color: "#3B82F6", isPositive: false, convertToClient: false };

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
    setForm({ name: s.name, color: s.color, isPositive: s.isPositive, convertToClient: s.convertToClient });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editingId) {
        // Handle "only one conversion stage" logic for leads
        if (pipelineType === "lead" && form.convertToClient) {
          const matched = items.find(s => s.convertToClient && s.id !== editingId);
          if (matched) {
            await pipelineApi.updateStage(matched.id, pipelineType, { convertToClient: false });
          }
        }

        await pipelineApi.updateStage(editingId, pipelineType, {
          name: form.name, 
          color: form.color,
          isPositive: editingId === lockedPositiveId ? true : form.isPositive,
          convertToClient: pipelineType === "lead" ? form.convertToClient : false,
        });
        toast({ title: `${pipelineType === "lead" ? "Lead" : "Recruit"} stage updated` });
      } else {
        // Handle "only one conversion stage" logic for leads
        if (pipelineType === "lead" && form.convertToClient) {
          const matched = items.find(s => s.convertToClient);
          if (matched) {
            await pipelineApi.updateStage(matched.id, pipelineType, { convertToClient: false });
          }
        }

        await pipelineApi.createStage({
          name: form.name, 
          color: form.color, 
          isPositive: form.isPositive,
          convertToClient: pipelineType === "lead" ? form.convertToClient : false,
          isDefault: false, 
          order: items.length + 1, 
          pipelineType,
        });
        toast({ title: `${pipelineType === "lead" ? "Lead" : "Recruit"} stage created` });
      }
      setShowModal(false);
      onReload();
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
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
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
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
            className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
              } ${dragIdx === idx ? "opacity-50" : ""}`}
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
            <span className="w-4 h-4 rounded-full shrink-0 border border-black/10" style={{ backgroundColor: s.color }} />
            <span className="flex-1 text-sm font-medium text-foreground">{s.name}</span>

            <div className="flex items-center gap-3">
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
                          } catch { } // eslint-disable-line no-empty
                        }}
                        className="data-[state=checked]:bg-green-500 shrink-0"
                      />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">Positive</span>
                    </div>
                  </TooltipTrigger>
                  {s.id === lockedPositiveId && <TooltipContent><p>This stage is always a positive outcome</p></TooltipContent>}
                </Tooltip>
              </TooltipProvider>

              {pipelineType === "lead" && (
                <div className="flex items-center gap-1.5 border-l pl-3">
                  <Switch
                    checked={s.convertToClient}
                    onCheckedChange={async (checked) => {
                      if (checked) {
                        const matched = items.find(st => st.convertToClient && st.id !== s.id);
                        if (matched) {
                          await pipelineApi.updateStage(matched.id, pipelineType, { convertToClient: false });
                        }
                      }
                      await pipelineApi.updateStage(s.id, pipelineType, { convertToClient: checked });
                      onReload();
                    }}
                    className="data-[state=checked]:bg-blue-500 shrink-0"
                  />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">Convert</span>
                </div>
              )}
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

            {pipelineType === "lead" && (
              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Convert to Client</p>
                  <p className="text-xs text-muted-foreground">Automatically trigger the conversion form when this stage is reached</p>
                </div>
                <Switch
                  checked={form.convertToClient}
                  onCheckedChange={v => setForm(f => ({ ...f, convertToClient: v }))}
                />
              </div>
            )}
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
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } // eslint-disable-line @typescript-eslint/no-explicit-any
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
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } // eslint-disable-line @typescript-eslint/no-explicit-any
    finally { setDeleting(false); }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await customFieldsApi.update(deactivateTarget.id, { active: false });
      toast({ title: `${deactivateTarget.name} deactivated` });
      setDeactivateTarget(null);
      load();
    } catch { } // eslint-disable-line no-empty
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
              <Select value={form.type} onValueChange={(v: FieldFormState["type"]) => setForm(f => ({ ...f, type: v }))}>
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
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } // eslint-disable-line @typescript-eslint/no-explicit-any
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
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } // eslint-disable-line @typescript-eslint/no-explicit-any
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
            className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
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
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } // eslint-disable-line @typescript-eslint/no-explicit-any
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
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); } // eslint-disable-line @typescript-eslint/no-explicit-any
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
            className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 transition-all ${overIdx === idx && dragIdx !== null ? "bg-primary/10 border-t-2 border-t-primary" : "hover:bg-accent/30"
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

// ==================== DUPLICATE DETECTION TAB ====================

const DuplicateDetectionTab: React.FC<{ settings: ContactManagementSettings | null, onReload: () => void }> = ({ settings, onReload }) => {
  const [detectionRule, setDetectionRule] = useState<string>(settings?.duplicateDetectionRule || "phone_or_email");
  const [detectionScope, setDetectionScope] = useState<string>(settings?.duplicateDetectionScope || "all_agents");
  const [manualAction, setManualAction] = useState<string>(settings?.manualAction || "warn");
  const [csvAction, setCsvAction] = useState<string>(settings?.csvAction || "flag");
  const [allowMerge, setAllowMerge] = useState(true);
  const [mergeWinner, setMergeWinner] = useState("newest");
  const [mergePermission, setMergePermission] = useState("agents_admins");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setDetectionRule(settings.duplicateDetectionRule);
      setDetectionScope(settings.duplicateDetectionScope);
      setManualAction(settings.manualAction);
      setCsvAction(settings.csvAction);
      setDirty(false);
    }
  }, [settings]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!settings?.organizationId) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("contact_management_settings")
        .upsert({
          organization_id: settings.organizationId,
          duplicate_detection_rule: detectionRule,
          duplicate_detection_scope: detectionScope,
          manual_action: manualAction,
          csv_action: csvAction,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
      
      toast({ title: "Duplicate detection settings saved" });
      onReload();
      setDirty(false);
    } catch (err) {
      console.error("Error saving duplicate settings:", err);
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const RadioOption = ({ name, value, current, onChange, label, desc }: { name: string; value: string; current: string; onChange: (v: string) => void; label: string; desc: string }) => (
    <label className="flex items-start gap-3 cursor-pointer py-2" onClick={() => { onChange(value); markDirty(); }}>
      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${current === value ? "border-[#3B82F6]" : "border-[#64748B]"}`}>
        {current === value && <div className="w-2 h-2 rounded-full bg-[#3B82F6]" />}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </label>
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">Duplicate Detection</h4>
        <p className="text-sm text-muted-foreground">Control how the system identifies and handles duplicate contacts.</p>
      </div>

      {/* Card 1 — Detection Rule */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Detection Rule</h5>
          <p className="text-xs text-muted-foreground">Choose what field combination triggers a duplicate warning.</p>
        </div>
        <div className="space-y-1">
          <RadioOption name="rule" value="phone_only" current={detectionRule} onChange={setDetectionRule} label="Match on Phone Only" desc="Flag as duplicate if phone number already exists" />
          <RadioOption name="rule" value="email_only" current={detectionRule} onChange={setDetectionRule} label="Match on Email Only" desc="Flag as duplicate if email address already exists" />
          <RadioOption name="rule" value="phone_or_email" current={detectionRule} onChange={setDetectionRule} label="Match on Phone OR Email" desc="Flag as duplicate if either field matches an existing contact" />
          <RadioOption name="rule" value="phone_and_email" current={detectionRule} onChange={setDetectionRule} label="Match on Phone AND Email" desc="Flag as duplicate if both fields match the same existing contact" />
        </div>
      </div>

      {/* Card 2 — Detection Scope */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Detection Scope</h5>
          <p className="text-xs text-muted-foreground">Define which contacts are checked when looking for duplicates.</p>
        </div>
        <div className="space-y-1">
          <RadioOption name="scope" value="all_agents" current={detectionScope} onChange={setDetectionScope} label="Check Across All Agents" desc="A duplicate is flagged regardless of which agent owns the contact" />
          <RadioOption name="scope" value="assigned_only" current={detectionScope} onChange={setDetectionScope} label="Check Within Assigned Agent Only" desc="Only flag as duplicate if the same agent already has that contact" />
        </div>
      </div>

      {/* Card 3 — On Duplicate Found */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">On Duplicate Found</h5>
          <p className="text-xs text-muted-foreground">Choose what happens when a duplicate is detected.</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">When Adding Manually</p>
          <RadioOption name="manual" value="warn" current={manualAction} onChange={setManualAction} label="Show Warning and Let Agent Decide" desc="Agent sees a side-by-side comparison and can save anyway, merge, or cancel" />
          <RadioOption name="manual" value="block" current={manualAction} onChange={setManualAction} label="Block Save Entirely" desc="Agent cannot save the contact until the duplicate is resolved" />
        </div>
        <div className="border-t border-border" />
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">When Importing via CSV</p>
          <RadioOption name="csv" value="skip" current={csvAction} onChange={setCsvAction} label="Skip Duplicates Automatically" desc="Duplicate rows are ignored and not imported" />
          <RadioOption name="csv" value="flag" current={csvAction} onChange={setCsvAction} label="Flag for Review" desc="Import proceeds but duplicates are marked for admin review" />
          <RadioOption name="csv" value="import" current={csvAction} onChange={setCsvAction} label="Import Anyway" desc="All rows import regardless of duplicates, a Duplicate tag is applied" />
        </div>
      </div>

      {/* Card 4 — Merge Settings */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h5 className="text-sm font-bold text-foreground">Merge Settings</h5>
          <p className="text-xs text-muted-foreground">Control how duplicate contacts can be merged.</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Allow Contact Merging</p>
            <p className="text-xs text-muted-foreground">When enabled, agents can merge two duplicate contact records into one.</p>
          </div>
          <Switch checked={allowMerge} onCheckedChange={v => { setAllowMerge(v); markDirty(); }} />
        </div>
        {allowMerge && (
          <div className="pl-4 border-l-2 border-border space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">When Merging, Which Record Wins</p>
              <RadioOption name="winner" value="newest" current={mergeWinner} onChange={setMergeWinner} label="Newest Record Keeps All Fields" desc="" />
              <RadioOption name="winner" value="oldest" current={mergeWinner} onChange={setMergeWinner} label="Oldest Record Keeps All Fields" desc="" />
              <RadioOption name="winner" value="manual" current={mergeWinner} onChange={setMergeWinner} label="Manual Field-by-Field Selection" desc="Agent chooses which value to keep for each field" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Who Can Merge Contacts</p>
              <RadioOption name="perm" value="agents_admins" current={mergePermission} onChange={setMergePermission} label="Agents and Admins" desc="" />
              <RadioOption name="perm" value="admins_only" current={mergePermission} onChange={setMergePermission} label="Admins Only" desc="" />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </div>
    </div>
  );
};

// ==================== REQUIRED FIELDS TAB ====================

const LEAD_REQUIRED_LOCKED = ["First Name", "Last Name", "Phone"];
const LEAD_OPTIONAL = ["Email", "State", "Lead Source", "Date of Birth", "Age", "Health Status", "Best Time to Call", "Assigned Agent"];
const CLIENT_REQUIRED_LOCKED = ["First Name", "Last Name", "Phone"];
const CLIENT_OPTIONAL = ["Email", "State", "Policy Type", "Carrier", "Policy Number", "Face Amount", "Premium Amount", "Issue Date", "Effective Date", "Beneficiary Name"];

const RequiredFieldsTab: React.FC<{ settings: ContactManagementSettings | null, onReload: () => void }> = ({ settings, onReload }) => {
  const [leadRequired, setLeadRequired] = useState<Record<string, boolean>>(() => {
    const r: Record<string, boolean> = {};
    LEAD_OPTIONAL.forEach(f => r[f] = settings?.requiredFieldsLead?.[f] || false);
    return r;
  });
  const [clientRequired, setClientRequired] = useState<Record<string, boolean>>(() => {
    const r: Record<string, boolean> = {};
    CLIENT_OPTIONAL.forEach(f => r[f] = settings?.requiredFieldsClient?.[f] || false);
    return r;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      const lr: Record<string, boolean> = {};
      LEAD_OPTIONAL.forEach(f => lr[f] = settings.requiredFieldsLead?.[f] || false);
      setLeadRequired(lr);

      const cr: Record<string, boolean> = {};
      CLIENT_OPTIONAL.forEach(f => cr[f] = settings.requiredFieldsClient?.[f] || false);
      setClientRequired(cr);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!settings?.organizationId) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("contact_management_settings")
        .upsert({
          organization_id: settings.organizationId,
          required_fields_lead: leadRequired,
          required_fields_client: clientRequired,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
      
      toast({ title: "Required field settings saved" });
      onReload();
    } catch (err) {
      console.error("Error saving required fields:", err);
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const FieldRow = ({ name, locked, checked, onChange }: { name: string; locked?: boolean; checked: boolean; onChange?: (v: boolean) => void }) => (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-b-0">
      <span className="text-sm text-foreground">{name}</span>
      <div className="flex items-center gap-2">
        {locked && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild><Lock className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger>
              <TooltipContent><p>This field is always required and cannot be turned off</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Switch checked={checked} disabled={locked} onCheckedChange={onChange} className={locked ? "opacity-40" : ""} />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">Required Fields</h4>
        <p className="text-sm text-muted-foreground">Choose which fields agents must fill in before a contact record can be saved.</p>
      </div>

      {/* Info banner */}
      <div className="bg-[#1E3A5F] border border-[#3B82F6] rounded-lg p-3 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-[#93C5FD] mt-0.5 shrink-0" />
        <p className="text-xs text-[#93C5FD]">Required fields are enforced when agents manually add or edit contacts. CSV imports flag missing required fields in the import preview but do not block the import.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Lead Fields */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h5 className="text-sm font-semibold text-foreground">Lead Fields</h5>
            <span className="text-[10px] bg-[#3B82F6]/20 text-[#3B82F6] px-1.5 py-0.5 rounded font-medium">Leads</span>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {LEAD_REQUIRED_LOCKED.map(f => <FieldRow key={f} name={f} locked checked />)}
            {LEAD_OPTIONAL.map(f => (
              <FieldRow key={f} name={f} checked={leadRequired[f]} onChange={v => setLeadRequired(prev => ({ ...prev, [f]: v }))} />
            ))}
          </div>
        </div>

        {/* Client Fields */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h5 className="text-sm font-semibold text-foreground">Client Fields</h5>
            <span className="text-[10px] bg-[#22C55E]/20 text-[#22C55E] px-1.5 py-0.5 rounded font-medium">Clients</span>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {CLIENT_REQUIRED_LOCKED.map(f => <FieldRow key={f} name={f} locked checked />)}
            {CLIENT_OPTIONAL.map(f => (
              <FieldRow key={f} name={f} checked={clientRequired[f]} onChange={v => setClientRequired(prev => ({ ...prev, [f]: v }))} />
            ))}
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save Required Fields"}</Button>
    </div>
  );
};

// ==================== ASSIGNMENT RULES TAB ====================

interface AgentProfile {
  id: string;
  name: string;
  initials: string;
}

const AssignmentRulesTab: React.FC<{ settings: ContactManagementSettings | null, onReload: () => void }> = ({ settings, onReload }) => {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [method, setMethod] = useState(settings?.assignmentMethod || "unassigned");
  const [specificAgent, setSpecificAgent] = useState(settings?.assignmentSpecificAgentId || "");
  const [rotation, setRotation] = useState<Record<string, boolean>>(() => {
    const r: Record<string, boolean> = {};
    settings?.assignmentRotation?.forEach(id => r[id] = true);
    return r;
  });
  const [importOverride, setImportOverride] = useState(settings?.importOverride || false);
  const [importMethod, setImportMethod] = useState(settings?.importMethod || "unassigned");
  const [importAgent, setImportAgent] = useState(settings?.importSpecificAgentId || "");
  const [importRotation, setImportRotation] = useState<Record<string, boolean>>(() => {
    const r: Record<string, boolean> = {};
    settings?.importRotation?.forEach(id => r[id] = true);
    return r;
  });

  useEffect(() => {
    if (settings) {
      setMethod(settings.assignmentMethod);
      setSpecificAgent(settings.assignmentSpecificAgentId || "");
      const r: Record<string, boolean> = {};
      settings.assignmentRotation?.forEach(id => r[id] = true);
      setRotation(r);
      
      setImportOverride(settings.importOverride);
      setImportMethod(settings.importMethod);
      setImportAgent(settings.importSpecificAgentId || "");
      const ir: Record<string, boolean> = {};
      settings.importRotation?.forEach(id => ir[id] = true);
      setImportRotation(ir);
    }
  }, [settings]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .not("role", "eq", "admin")
          .eq("status", "Active");

        if (error) throw error;

        const transformed: AgentProfile[] = (data || []).map(p => ({
          id: p.id,
          name: `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unknown Agent",
          initials: `${p.first_name?.[0] || ""}${p.last_name?.[0] || ""}`.toUpperCase() || "??",
        }));

        setAgents(transformed);
        
        // If rotation is empty, initialize it with all agents
        if (!settings?.assignmentRotation?.length) {
          const rot: Record<string, boolean> = {};
          transformed.forEach(a => rot[a.id] = true);
          setRotation(prev => Object.keys(prev).length ? prev : rot);
        }
        if (!settings?.importRotation?.length) {
          const iRot: Record<string, boolean> = {};
          transformed.forEach(a => iRot[a.id] = true);
          setImportRotation(prev => Object.keys(prev).length ? prev : iRot);
        }
      } catch (err) {
        console.error("Error fetching agents for assignment rules:", err);
      } finally {
        setLoadingAgents(false);
      }
    };

    fetchAgents();
  }, [settings?.assignmentRotation?.length, settings?.importRotation?.length]);

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (method === "specific" && !specificAgent) {
      toast({ title: "Please select an agent before saving", variant: "destructive" });
      return;
    }
    if (importOverride && importMethod === "specific" && !importAgent) {
      toast({ title: "Please select an agent for import assignment", variant: "destructive" });
      return;
    }
    if (!settings?.organizationId) return;
    
    setSaving(true);
    try {
      const { error } = await (supabase as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from("contact_management_settings")
        .upsert({
          organization_id: settings.organizationId,
          assignment_method: method,
          assignment_specific_agent_id: specificAgent || null,
          assignment_rotation: Object.keys(rotation).filter(id => rotation[id]),
          import_override: importOverride,
          import_method: importMethod,
          import_specific_agent_id: importAgent || null,
          import_rotation: Object.keys(importRotation).filter(id => importRotation[id]),
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
      
      toast({ title: "Assignment rules saved" });
      onReload();
    } catch (err) {
      console.error("Error saving assignment rules:", err);
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const firstInRotation = agents.find(a => rotation[a.id]);
  const firstInImportRotation = agents.find(a => importRotation[a.id]);
  const allRotationOff = agents.every(a => !rotation[a.id]);
  const allImportRotationOff = agents.every(a => !importRotation[a.id]);

  const RadioOption = ({ value, current, onChange, label, desc }: { value: string; current: string; onChange: (v: string) => void; label: string; desc: string }) => (
    <label className="flex items-start gap-3 cursor-pointer py-2" onClick={() => onChange(value)}>
      <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${current === value ? "border-[#3B82F6]" : "border-[#64748B]"}`}>
        {current === value && <div className="w-2 h-2 rounded-full bg-[#3B82F6]" />}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
    </label>
  );

  const renderMethodFields = (
    m: string, agent: string, setAgent: (v: string) => void,
    rot: Record<string, boolean>, setRot: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
    allOff: boolean, firstIn: AgentProfile | undefined
  ) => (
    <>
      {m === "specific" && (
        <div className="pl-7 mt-2">
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">Assign all new contacts to:</label>
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select an agent..." /></SelectTrigger>
            <SelectContent>
              {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {m === "round_robin" && (
        <div className="pl-7 mt-2 space-y-2">
          {agents.map(a => (
            <div key={a.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[#3B82F6]/20 text-[#3B82F6] flex items-center justify-center text-[10px] font-bold">{a.initials}</div>
                <span className="text-sm text-foreground">{a.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Include</span>
                <Switch checked={rot[a.id]} onCheckedChange={v => setRot(prev => ({ ...prev, [a.id]: v }))} />
              </div>
            </div>
          ))}
          {allOff ? (
            <div className="bg-[#431407] border border-[#F97316] rounded-lg p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#F97316] mt-0.5 shrink-0" />
              <p className="text-xs text-[#F97316]">No agents are in the rotation. New contacts will be Unassigned until at least one agent is added.</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Next in queue: {firstIn?.name}</p>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">Assignment Rules</h4>
        <p className="text-sm text-muted-foreground">Control how new leads are assigned when added manually or imported via CSV.</p>
      </div>

      <div className="bg-[#1E3A5F] border border-[#3B82F6] rounded-lg p-3 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-[#93C5FD] mt-0.5 shrink-0" />
        <p className="text-xs text-[#93C5FD]">Changing assignment rules does not retroactively reassign existing contacts. Only applies to new contacts going forward.</p>
      </div>

      {/* Card 1 */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Default Assignment Method</h5>
          <p className="text-xs text-muted-foreground">Choose how new leads are assigned when added to the system.</p>
        </div>
        <RadioOption value="unassigned" current={method} onChange={setMethod} label="Unassigned" desc="New contacts are added without an assigned agent. Admin or agents assign manually." />
        <RadioOption value="specific" current={method} onChange={setMethod} label="Always Assign to Specific Agent" desc="Every new contact is assigned to one designated agent." />
        <RadioOption value="round_robin" current={method} onChange={setMethod} label="Round Robin Among Active Agents" desc="New contacts are distributed evenly among agents in the rotation." />
        {renderMethodFields(method, specificAgent, setSpecificAgent, rotation, setRotation, allRotationOff, firstInRotation)}
      </div>

      {/* Card 2 */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Import Override</h5>
          <p className="text-xs text-muted-foreground">Choose whether CSV imports follow the same assignment rule or use a different method.</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-foreground">Use a different assignment method for CSV imports</p>
          <Switch checked={importOverride} onCheckedChange={v => { setImportOverride(v); if (v) setImportMethod("unassigned"); }} />
        </div>
        {importOverride && (
          <div className="space-y-1 pt-2 border-t border-border">
            <RadioOption value="unassigned" current={importMethod} onChange={setImportMethod} label="Unassigned" desc="Imported contacts have no agent assigned." />
            <RadioOption value="specific" current={importMethod} onChange={setImportMethod} label="Always Assign to Specific Agent" desc="Every imported contact is assigned to one designated agent." />
            <RadioOption value="round_robin" current={importMethod} onChange={setImportMethod} label="Round Robin Among Active Agents" desc="Imported contacts are distributed evenly." />
            {renderMethodFields(importMethod, importAgent, setImportAgent, importRotation, setImportRotation, allImportRotationOff, firstInImportRotation)}
          </div>
        )}
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save Assignment Rules"}</Button>
    </div>
  );
};

// ==================== DISPLAY SETTINGS TAB ====================

const ALL_COLUMNS = [
  { name: "Name", locked: true, defaultChecked: true },
  { name: "Phone", locked: true, defaultChecked: true },
  { name: "Status", locked: true, defaultChecked: true },
  { name: "Email", locked: false, defaultChecked: true },
  { name: "State", locked: false, defaultChecked: true },
  { name: "Lead Source", locked: false, defaultChecked: true },
  { name: "Lead Score", locked: false, defaultChecked: false },
  { name: "Age", locked: false, defaultChecked: true },
  { name: "Assigned Agent", locked: false, defaultChecked: true },
  { name: "Last Contacted", locked: false, defaultChecked: true },
  { name: "Created Date", locked: false, defaultChecked: false },
];

const SORT_OPTIONS = ["Name", "Phone", "Status", "Lead Source", "Lead Score", "Age", "Last Contacted", "Created Date"];

const DisplaySettingsTab: React.FC = () => {
  const { user } = useAuth();
  const [columns, setColumns] = useState(() => ALL_COLUMNS.map((c, i) => ({ ...c, checked: c.defaultChecked, order: i })));
  const [sortBy, setSortBy] = useState("Created Date");
  const [sortDesc, setSortDesc] = useState(true);
  const [perPage, setPerPage] = useState(25);
  const [agingFresh, setAgingFresh] = useState(3);
  const [agingOld, setAgingOld] = useState(7);
  const [agingStale, setAgingStale] = useState(14);
  const [defaultTab, setDefaultTab] = useState("overview");
  const [saving, setSaving] = useState(false);
  const [agingErrors, setAgingErrors] = useState<Record<string, string>>({});
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) { setLoadingPrefs(false); return; }
    (async () => {
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select("preference_value")
          .eq("user_id", user.id)
          .eq("preference_key", "contact_columns")
          .single();
        if (data?.preference_value) {
          setColumns(data.preference_value as typeof columns);
        }
      } finally {
        setLoadingPrefs(false);
      }
    })();
  }, [user?.id]);

  const checkedColumns = columns.filter(c => c.checked).sort((a, b) => a.order - b.order);
  const previewText = checkedColumns.map(c => c.name).join(", ");

  const toggleColumn = (name: string) => {
    setColumns(prev => prev.map(c => c.name === name && !c.locked ? { ...c, checked: !c.checked } : c));
  };

  const handleColumnDrop = (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setOverIdx(null); return; }
    const reordered = [...checkedColumns];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const orderMap: Record<string, number> = {};
    reordered.forEach((c, i) => orderMap[c.name] = i);
    setColumns(prev => prev.map(c => c.checked && orderMap[c.name] !== undefined ? { ...c, order: orderMap[c.name] } : c));
    setDragIdx(null);
    setOverIdx(null);
  };

  const validateAging = (): boolean => {
    const errors: Record<string, string> = {};
    if (agingFresh < 1) errors.fresh = "Must be at least 1";
    if (agingOld <= agingFresh) errors.old = `Must be greater than ${agingFresh}`;
    if (agingStale <= agingOld) errors.stale = `Must be greater than ${agingOld}`;
    setAgingErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateAging()) {
      toast({ title: "Please fix the errors before saving", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (user?.id) {
        const { error } = await supabase
          .from("user_preferences")
          .upsert(
            { user_id: user.id, preference_key: "contact_columns", preference_value: columns },
            { onConflict: "user_id,preference_key" }
          );
        if (error) throw error;
      }
      toast({ title: "Display settings saved" });
    } catch (err) {
      console.error("Failed to save display settings:", err);
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const RadioTile = ({ value, current, onChange, label }: { value: string; current: string; onChange: (v: string) => void; label: string }) => (
    <button onClick={() => onChange(value)} className={`px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${current === value ? "border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10" : "border-border text-muted-foreground hover:border-[#64748B]"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">Display Settings</h4>
        <p className="text-sm text-muted-foreground">Control how the Contacts page looks and behaves by default for all agents.</p>
      </div>

      {/* Card 1 — Default Table Columns */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Default Table Columns</h5>
          <p className="text-xs text-muted-foreground">Choose which columns appear in the Leads table by default. Agents can customize their own view but this sets the starting point.</p>
        </div>
        <div className="space-y-1">
          {/* Locked columns first */}
          {columns.filter(c => c.locked).map(c => (
            <div key={c.name} className="flex items-center gap-3 px-3 py-2 rounded-lg">
              <Checkbox checked disabled className="opacity-40" />
              <span className="flex-1 text-sm text-foreground">{c.name}</span>
              <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          ))}
          {/* Toggleable columns */}
          {columns.filter(c => !c.locked).map(c => (
            <div key={c.name} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors">
              <Checkbox checked={c.checked} onCheckedChange={() => toggleColumn(c.name)} />
              <span className="flex-1 text-sm text-foreground">{c.name}</span>
              {c.checked && <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />}
            </div>
          ))}
        </div>
        {/* Drag reorder for checked columns */}
        {checkedColumns.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Drag to reorder visible columns:</p>
            <div className="flex flex-wrap gap-1.5">
              {checkedColumns.map((c, idx) => (
                <span
                  key={c.name}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={e => { e.preventDefault(); setOverIdx(idx); }}
                  onDrop={() => handleColumnDrop(idx)}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                  className={`text-[11px] px-2 py-1 rounded border cursor-grab transition-all ${overIdx === idx && dragIdx !== null ? "border-[#3B82F6] bg-[#3B82F6]/10" : "border-border bg-muted"} ${dragIdx === idx ? "opacity-50" : ""} text-foreground`}
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Current column order: {previewText}</p>
      </div>

      {/* Card 2 — Default Sort */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Default Sort</h5>
          <p className="text-xs text-muted-foreground">Choose how the Leads table is sorted when an agent first loads it.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground block mb-1">Sort by</label>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-4">
            <span className="text-xs text-muted-foreground">Ascending</span>
            <Switch checked={sortDesc} onCheckedChange={setSortDesc} />
            <span className="text-xs text-muted-foreground">Descending</span>
          </div>
        </div>
      </div>

      {/* Card 3 — Records Per Page */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Records Per Page</h5>
          <p className="text-xs text-muted-foreground">How many contacts load per page in the Leads table.</p>
        </div>
        <div className="flex gap-3">
          {[25, 50, 100].map(n => (
            <button key={n} onClick={() => setPerPage(n)} className={`flex-1 py-3 rounded-lg border-2 text-lg font-bold transition-all ${perPage === n ? "border-[#3B82F6] text-[#3B82F6] bg-[#3B82F6]/10" : "border-border text-muted-foreground hover:border-[#64748B]"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Card 4 — Lead Aging Thresholds */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <h5 className="text-sm font-bold text-foreground">Lead Aging Thresholds</h5>
          <p className="text-xs text-muted-foreground">Customize when lead aging indicators change color. Based on days since last contact.</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-[#22C55E] shrink-0" />
            <span className="text-sm text-foreground w-24">Fresh</span>
            <span className="text-xs text-muted-foreground w-8">0 to</span>
            <Input type="number" value={agingFresh} onChange={e => { setAgingFresh(parseInt(e.target.value) || 0); setAgingErrors({}); }} className="w-20" min={1} />
            <span className="text-xs text-muted-foreground">days</span>
          </div>
          {agingErrors.fresh && <p className="text-xs text-[#EF4444] pl-11">{agingErrors.fresh}</p>}

          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-[#EAB308] shrink-0" />
            <span className="text-sm text-foreground w-24">Getting Old</span>
            <span className="text-xs text-muted-foreground w-8">{agingFresh + 1} to</span>
            <Input type="number" value={agingOld} onChange={e => { setAgingOld(parseInt(e.target.value) || 0); setAgingErrors({}); }} className="w-20" min={agingFresh + 1} />
            <span className="text-xs text-muted-foreground">days</span>
          </div>
          {agingErrors.old && <p className="text-xs text-[#EF4444] pl-11">{agingErrors.old}</p>}

          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-[#F97316] shrink-0" />
            <span className="text-sm text-foreground w-24">Stale</span>
            <span className="text-xs text-muted-foreground w-8">{agingOld + 1} to</span>
            <Input type="number" value={agingStale} onChange={e => { setAgingStale(parseInt(e.target.value) || 0); setAgingErrors({}); }} className="w-20" min={agingOld + 1} />
            <span className="text-xs text-muted-foreground">days</span>
          </div>
          {agingErrors.stale && <p className="text-xs text-[#EF4444] pl-11">{agingErrors.stale}</p>}

          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-[#EF4444] shrink-0 flex items-center justify-center text-[8px]">🔥</span>
            <span className="text-sm text-foreground w-24">Urgent</span>
            <span className="text-xs text-muted-foreground">{agingStale + 1}+ days</span>
          </div>
        </div>

        {/* Live preview bar */}
        <div className="mt-3">
          <div className="flex h-6 rounded-lg overflow-hidden border border-border">
            <div className="bg-[#22C55E] flex-1 flex items-center justify-center text-[9px] font-bold text-white">0-{agingFresh}d</div>
            <div className="bg-[#EAB308] flex-1 flex items-center justify-center text-[9px] font-bold text-white">{agingFresh + 1}-{agingOld}d</div>
            <div className="bg-[#F97316] flex-1 flex items-center justify-center text-[9px] font-bold text-white">{agingOld + 1}-{agingStale}d</div>
            <div className="bg-[#EF4444] flex-1 flex items-center justify-center text-[9px] font-bold text-white">{agingStale + 1}+d</div>
          </div>
        </div>
      </div>

      {/* Card 5 — Contact Modal Default Tab */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div>
          <h5 className="text-sm font-bold text-foreground">Contact Modal Default Tab</h5>
          <p className="text-xs text-muted-foreground">Choose which tab opens first when an agent clicks on a contact.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "overview", label: "Overview" },
            { value: "activity", label: "Activity" },
            { value: "calls", label: "Calls" },
            { value: "notes", label: "Notes" },
          ].map(t => (
            <RadioTile key={t.value} value={t.value} current={defaultTab} onChange={setDefaultTab} label={t.label} />
          ))}
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving || loadingPrefs} className="w-full">{saving ? "Saving..." : "Save Display Settings"}</Button>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

const ContactManagement: React.FC = () => {
  const { organizationId } = useOrganization();
  const [activeTab, setActiveTab] = useState(0);
  const [settings, setSettings] = useState<ContactManagementSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!organizationId) return;
    try {
      setLoadingSettings(true);
      const { data, error } = await supabase
        .from("contact_management_settings")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          organizationId: data.organization_id,
          duplicateDetectionRule: data.duplicate_detection_rule,
          duplicateDetectionScope: data.duplicate_detection_scope,
          manualAction: data.manual_action,
          csvAction: data.csv_action,
          requiredFieldsLead: data.required_fields_lead as Record<string, boolean>,
          requiredFieldsClient: data.required_fields_client as Record<string, boolean>,
          assignmentMethod: data.assignment_method,
          assignmentSpecificAgentId: data.assignment_specific_agent_id,
          assignmentRotation: data.assignment_rotation as string[],
          importOverride: data.import_override,
          importMethod: data.import_method,
          importSpecificAgentId: data.import_specific_agent_id,
          importRotation: data.import_rotation as string[],
          updatedAt: data.updated_at,
        });
      } else {
        // Initialize with defaults if no settings exist for this org
        setSettings({
          id: "",
          organizationId: organizationId,
          duplicateDetectionRule: 'phone_or_email',
          duplicateDetectionScope: 'all_agents',
          manualAction: 'warn',
          csvAction: 'flag',
          requiredFieldsLead: {},
          requiredFieldsClient: {},
          assignmentMethod: 'unassigned',
          assignmentRotation: [],
          importOverride: false,
          importMethod: 'unassigned',
          importRotation: [],
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Error fetching contact settings:", err);
      toast({ title: "Error loading contact settings", variant: "destructive" });
    } finally {
      setLoadingSettings(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (organizationId) {
      fetchSettings();
    }
  }, [organizationId, fetchSettings]);

  if (loadingSettings && organizationId) {
    return (
      <div className="flex items-center justify-center p-12 bg-card rounded-xl border border-border">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Contact Management</h3>
        <p className="text-sm text-muted-foreground">Configure pipeline stages, custom fields, lead sources, and health statuses.</p>
      </div>

      {/* Tab bar */}
      <div className="border-b overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${activeTab === i
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
      {activeTab === 4 && <DuplicateDetectionTab settings={settings} onReload={fetchSettings} />}
      {activeTab === 5 && <RequiredFieldsTab settings={settings} onReload={fetchSettings} />}
      {activeTab === 6 && <AssignmentRulesTab settings={settings} onReload={fetchSettings} />}
      {activeTab === 7 && <DisplaySettingsTab />}
    </div>
  );
};

export default ContactManagement;
