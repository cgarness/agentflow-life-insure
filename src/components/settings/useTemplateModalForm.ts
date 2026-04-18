import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { saveMessageTemplate } from "@/components/settings/saveMessageTemplate";
import { useTemplateFileAttachments } from "@/components/settings/useTemplateFileAttachments";
import { templateFormSchema } from "@/components/settings/templateModalSchema";
import type { Template, TemplateAttachment, TemplateCategory } from "@/components/settings/messageTemplateTypes";

export function useTemplateModalForm(
  open: boolean,
  onOpenChange: (o: boolean) => void,
  editTarget: Template | null,
  organizationId: string | null,
  onSaved: () => void,
) {
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"email" | "sms">("email");
  const [formSubject, setFormSubject] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState<TemplateCategory | null>(null);
  const [formAttachments, setFormAttachments] = useState<TemplateAttachment[]>([]);
  const { fileInputRef, handleFileChange, removeAttachment } = useTemplateFileAttachments(
    organizationId,
    formAttachments,
    setFormAttachments,
  );
  const [formErrors, setFormErrors] = useState<{ name?: boolean; content?: boolean; subject?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [isPreview, setIsPreview] = useState(false);

  const contentRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const cursorPosRef = useRef(0);

  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);

  useEffect(() => {
    if (!open) return;
    setIsPreview(false);
    pendingSelectionRef.current = null;
    if (editTarget) {
      setFormName(editTarget.name);
      setFormType(editTarget.type);
      setFormSubject(editTarget.subject || "");
      setFormContent(editTarget.content);
      setFormCategory(editTarget.category);
      setFormAttachments(editTarget.attachments);
      setFormErrors({});
    } else {
      setFormName("");
      setFormType("email");
      setFormSubject("");
      setFormContent("");
      setFormCategory(null);
      setFormAttachments([]);
      setFormErrors({});
    }
  }, [open, editTarget]);

  useEffect(() => {
    const pos = pendingSelectionRef.current;
    if (pos === null) return;
    pendingSelectionRef.current = null;
    requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, [formContent]);

  const insertAtCursor = useCallback((text: string) => {
    setFormContent((prev) => {
      const start = cursorPosRef.current;
      const safeStart = Math.min(Math.max(start, 0), prev.length);
      const newContent = prev.slice(0, safeStart) + text + prev.slice(safeStart);
      const newPos = safeStart + text.length;
      pendingSelectionRef.current = newPos;
      queueMicrotask(() => {
        cursorPosRef.current = newPos;
        setCursorPos(newPos);
        setFormErrors((e) => ({ ...e, content: false }));
      });
      return newContent;
    });
  }, []);

  const handleTypeChange = (v: "email" | "sms") => {
    setFormType(v);
  };

  const handleSave = async () => {
    const attachmentsPayload = formAttachments;
    const parsed = templateFormSchema.safeParse({
      name: formName,
      content: formContent,
      type: formType,
      subject: formType === "email" ? formSubject : null,
      attachments: attachmentsPayload,
      category: formCategory,
    });

    if (!parsed.success) {
      const issues = parsed.error.flatten().fieldErrors;
      setFormErrors({
        name: !!issues.name?.length,
        content: !!issues.content?.length,
        subject: !!issues.subject?.length,
      });
      return;
    }

    if (!organizationId) {
      toast({ title: "Organization required", variant: "destructive" });
      return;
    }

    try {
      setSaving(true);
      const result = await saveMessageTemplate({
        editTargetId: editTarget?.id ?? null,
        organizationId,
        name: parsed.data.name,
        type: parsed.data.type,
        subject: parsed.data.type === "email" ? parsed.data.subject?.trim() ?? null : null,
        content: parsed.data.content,
        attachments: attachmentsPayload,
        category: parsed.data.category ?? null,
      });

      if (!result.ok) {
        toast({ title: "Failed to save template", description: result.message, variant: "destructive" });
        return;
      }

      toast({
        title: editTarget ? "Template updated" : "Template created",
        className: "bg-success text-success-foreground border-success",
      });
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return {
    formName,
    setFormName,
    formType,
    handleTypeChange,
    formSubject,
    setFormSubject,
    formContent,
    setFormContent,
    formCategory,
    setFormCategory,
    formAttachments,
    formErrors,
    setFormErrors,
    saving,
    cursorPos,
    setCursorPos,
    isPreview,
    setIsPreview,
    contentRef,
    fileInputRef,
    insertAtCursor,
    handleFileChange,
    removeAttachment,
    handleSave,
  };
}
