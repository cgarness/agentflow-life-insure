import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRODUCT_TYPES, type ProductType } from "./callScriptSchema";

interface AddCallScriptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  type: ProductType;
  active: boolean;
  nameError: string | null;
  adding: boolean;
  onNameChange: (v: string) => void;
  onTypeChange: (v: ProductType) => void;
  onActiveChange: (v: boolean) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const AddCallScriptDialog: React.FC<AddCallScriptDialogProps> = ({
  open,
  onOpenChange,
  name,
  type,
  active,
  nameError,
  adding,
  onNameChange,
  onTypeChange,
  onActiveChange,
  onSubmit,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Script</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Script Name</label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value.slice(0, 60))}
              placeholder="e.g. Term Life Closer"
              className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !adding) onSubmit();
              }}
            />
            {nameError && <p className="text-xs text-destructive mt-1.5 font-medium">{nameError}</p>}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Product Type</label>
            <Select value={type} onValueChange={(v) => onTypeChange(v as ProductType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between bg-accent/30 p-3 rounded-lg border">
            <div className="space-y-0.5">
              <label className="text-sm font-medium text-foreground">Active Status</label>
              <div className="text-xs text-muted-foreground">Agents can use this script on calls</div>
            </div>
            <Switch checked={active} onCheckedChange={onActiveChange} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={adding}>Cancel</Button>
          <Button onClick={onSubmit} disabled={adding} className="gap-2">
            {adding && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Script
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
