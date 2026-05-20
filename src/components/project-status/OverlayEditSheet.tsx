import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { overlayEditSchema, statusOptionsForSection, type OverlayEditForm } from "@/lib/project-status/overlaySchema";
import type { ProjectStatusOverlay } from "@/lib/project-status/types";

export interface OverlayEditTarget {
  itemKey: string;
  section: string;
  title: string;
  inferredStatus?: string;
}

interface OverlayEditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: OverlayEditTarget | null;
  overlay: ProjectStatusOverlay | undefined;
  onSave: (payload: { item_key: string; section: string; status: string | null; note: string | null }) => Promise<void>;
}

const OverlayEditSheet: React.FC<OverlayEditSheetProps> = ({
  open, onOpenChange, target, overlay, onSave,
}) => {
  const options = target ? [...statusOptionsForSection(target.section)] : [];

  const form = useForm<OverlayEditForm>({
    resolver: zodResolver(overlayEditSchema),
    defaultValues: { status: "", note: "" },
  });

  useEffect(() => {
    if (!target) return;
    form.reset({
      status: overlay?.status ?? target.inferredStatus ?? "",
      note: overlay?.note ?? "",
    });
  }, [target, overlay, form]);

  const submit = form.handleSubmit(async (values) => {
    if (!target) return;
    await onSave({
      item_key: target.itemKey,
      section: target.section,
      status: values.status?.trim() || null,
      note: values.note?.trim() || null,
    });
    onOpenChange(false);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-8">{target?.title ?? "Edit overlay"}</SheetTitle>
          <SheetDescription>
            Overlay only — canonical records stay in VISION.md and WORK_LOG.md.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.watch("status") || "__none__"}
              onValueChange={(v) => form.setValue("status", v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Use doc default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(doc default)</SelectItem>
                {options.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea rows={6} {...form.register("note")} placeholder="Working notes…" />
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>Save</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default OverlayEditSheet;
