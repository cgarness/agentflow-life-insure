import { Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Template, TemplateCategory } from "@/components/settings/messageTemplateTypes";
import { TEMPLATE_CATEGORY_OPTIONS } from "@/components/settings/templateCategories";
import { MergeFieldsPopover } from "@/components/settings/MergeFieldsPopover";
import { EmojiPickerPopover } from "@/components/settings/EmojiPickerPopover";
import { TemplateSmsCounter } from "@/components/settings/TemplateSmsCounter";
import { TemplatePreviewPanel } from "@/components/settings/TemplatePreviewPanel";
import { TemplateAttachmentChips } from "@/components/settings/TemplateAttachmentChips";
import { useTemplateModalForm } from "@/components/settings/useTemplateModalForm";

export interface TemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: Template | null;
  organizationId: string | null;
  onSaved: () => void;
}

export function TemplateModal({ open, onOpenChange, editTarget, organizationId, onSaved }: TemplateModalProps) {
  const f = useTemplateModalForm(open, onOpenChange, editTarget, organizationId, onSaved);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pr-12 sm:pr-14">
          <DialogTitle className="min-w-0 flex-1 pr-2 text-left">{editTarget ? "Edit Template" : "Add Template"}</DialogTitle>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={f.formType === "email" ? "default" : "secondary"} className="uppercase text-[10px] tracking-wider">
              {f.formType}
            </Badge>
            <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => f.setIsPreview((p) => !p)}>
              {f.isPreview ? "Edit" : "Preview"}
            </Button>
          </div>
        </DialogHeader>

        {f.isPreview ? (
          <TemplatePreviewPanel type={f.formType} subject={f.formSubject} content={f.formContent} />
        ) : (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-3">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Template Name</label>
                <Input
                  value={f.formName}
                  onChange={(e) => {
                    f.setFormName(e.target.value);
                    f.setFormErrors((prev) => ({ ...prev, name: false }));
                  }}
                  placeholder="e.g. Term policy follow-up"
                  className={f.formErrors.name ? "border-destructive focus-visible:ring-destructive" : ""}
                />
              </div>
              <div className="col-span-1">
                <label className="mb-1.5 block text-sm font-medium text-foreground">Type</label>
                <Select value={f.formType} onValueChange={(v) => f.handleTypeChange(v as "email" | "sms")} disabled={!!editTarget}>
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

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Category</label>
              <Select
                value={f.formCategory ?? "__none__"}
                onValueChange={(v) => f.setFormCategory(v === "__none__" ? null : (v as TemplateCategory))}
              >
                <SelectTrigger className="bg-card">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {TEMPLATE_CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {f.formType === "email" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Subject Line</label>
                <Input
                  value={f.formSubject}
                  onChange={(e) => {
                    f.setFormSubject(e.target.value);
                    f.setFormErrors((prev) => ({ ...prev, subject: false }));
                  }}
                  placeholder="e.g. Your term life quote is ready"
                  className={f.formErrors.subject ? "border-destructive focus-visible:ring-destructive" : ""}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                <MergeFieldsPopover onInsert={f.insertAtCursor} />
                <input
                  ref={f.fileInputRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  multiple
                  onChange={f.handleFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => f.fileInputRef.current?.click()}
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  Attach
                </Button>
                <EmojiPickerPopover onInsert={f.insertAtCursor} />
              </div>
              {f.formType === "sms" && (
                <p className="text-xs text-muted-foreground">
                  SMS is sent as text only; attachments are saved with this template for your own reference (for example a rate sheet or call script).
                </p>
              )}
              <label className="block text-sm font-medium text-foreground">Message Content</label>
              <textarea
                ref={f.contentRef}
                value={f.formContent}
                onChange={(e) => {
                  const pos = e.target.selectionStart ?? 0;
                  f.setFormContent(e.target.value);
                  f.setCursorPos(pos);
                  f.setFormErrors((prev) => ({ ...prev, content: false }));
                }}
                onSelect={(e) => f.setCursorPos(e.currentTarget.selectionStart)}
                onClick={(e) => f.setCursorPos(e.currentTarget.selectionStart)}
                placeholder={f.formType === "email" ? "Type your email body here..." : "Type your SMS here..."}
                className={`flex h-40 w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus:ring-1 focus:ring-primary ${
                  f.formErrors.content ? "border-destructive focus-visible:ring-destructive" : "border-input"
                }`}
              />
              {f.formAttachments.length > 0 && (
                <TemplateAttachmentChips attachments={f.formAttachments} onRemove={f.removeAttachment} />
              )}
              {f.formType === "sms" && <TemplateSmsCounter content={f.formContent} />}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={f.saving}>
            Cancel
          </Button>
          <Button onClick={f.handleSave} disabled={f.saving || !organizationId} className="gap-2">
            {f.saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editTarget ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
