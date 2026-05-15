import React, { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { folderSchema, type WorkflowFolderRow } from "@/lib/workflow-types";

const COLOR_PRESETS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#0ea5e9"];

interface Props {
  open: boolean;
  initial?: WorkflowFolderRow | null;
  onOpenChange: (v: boolean) => void;
  onSubmit: (input: { name: string; color: string }) => Promise<void>;
}

const NewFolderModal: React.FC<Props> = ({ open, initial, onOpenChange, onSubmit }) => {
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setColor(initial?.color ?? COLOR_PRESETS[0]);
    }
  }, [open, initial]);

  const handleSave = async () => {
    const r = folderSchema.safeParse({ name, color });
    if (!r.success) { toast({ title: r.error.issues[0].message, variant: "destructive" }); return; }
    setSaving(true);
    try {
      await onSubmit(r.data);
      onOpenChange(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to save folder", variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{initial ? "Rename Folder" : "New Folder"}</DialogTitle>
          <DialogDescription>Group related workflows under a folder tab.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 50))}
              placeholder="e.g., Hot Leads"
              maxLength={50}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Color</label>
            <div className="flex gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : initial ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewFolderModal;
