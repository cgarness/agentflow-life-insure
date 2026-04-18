import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { TemplateAttachment } from "@/components/settings/messageTemplateTypes";
import {
  TEMPLATE_ATTACHMENTS_BUCKET,
  TEMPLATE_ATTACHMENT_ACCEPT_EXT,
} from "@/components/settings/templateAttachmentUtils";

export function useTemplateFileAttachments(
  organizationId: string | null,
  formAttachments: TemplateAttachment[],
  setFormAttachments: Dispatch<SetStateAction<TemplateAttachment[]>>,
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(formAttachments);
  useEffect(() => {
    attachmentsRef.current = formAttachments;
  }, [formAttachments]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    if (!organizationId) {
      toast({ title: "Organization required", variant: "destructive" });
      e.target.value = "";
      return;
    }

    let next = [...attachmentsRef.current];
    for (const file of Array.from(files)) {
      if (next.length >= 3) {
        toast({ title: "Maximum 3 attachments", description: "Remove a file to add another.", variant: "destructive" });
        break;
      }
      const lower = file.name.toLowerCase();
      const allowed = TEMPLATE_ATTACHMENT_ACCEPT_EXT.some((ext) => lower.endsWith(ext));
      if (!allowed) {
        toast({
          title: "Invalid file type",
          description: "Accepted: PDF, PNG, JPG, DOCX.",
          variant: "destructive",
        });
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "File too large", description: "Maximum 5 MB per file.", variant: "destructive" });
        continue;
      }
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${organizationId}/${Date.now()}_${safeName}`;
      const { error } = await supabase.storage.from(TEMPLATE_ATTACHMENTS_BUCKET).upload(path, file);
      if (error) {
        toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        continue;
      }
      next = [...next, { name: file.name, url: path, size: file.size }];
    }
    setFormAttachments(next);
    e.target.value = "";
  };

  const removeAttachment = async (storagePath: string) => {
    const { error } = await supabase.storage.from(TEMPLATE_ATTACHMENTS_BUCKET).remove([storagePath]);
    if (error) {
      toast({ title: "Could not remove file", description: error.message, variant: "destructive" });
      return;
    }
    setFormAttachments((prev) => prev.filter((a) => a.url !== storagePath));
  };

  return { fileInputRef, handleFileChange, removeAttachment };
}
