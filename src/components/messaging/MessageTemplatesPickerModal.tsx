import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import {
  applyMessageTemplateMerge,
  unresolvedTemplateFields,
  type MessageTemplateMergeInput,
} from "@/lib/messageTemplateMerge";
import {
  MessageTemplatePickerList,
  type MessageTemplateRow,
} from "@/components/messaging/MessageTemplatePickerList";
import { MessageTemplateEditPreview } from "@/components/messaging/MessageTemplateEditPreview";

export interface MessageTemplatesPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: "sms" | "email";
  mergeInput: MessageTemplateMergeInput;
  hasDraft?: boolean;
  onApply: (payload: { body: string; subject: string | null; purpose?: "informational" | "marketing" | null }) => void;
}

interface PreviewDraft {
  identityKey: string;
  template: MessageTemplateRow;
  body: string;
  subject: string;
  missingFields: string[];
}

export function MessageTemplatesPickerModal({
  open, onOpenChange, channel, mergeInput, hasDraft = false, onApply,
}: MessageTemplatesPickerModalProps) {
  const { organizationId } = useOrganization();
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const contactId = mergeInput.contact?.id ?? mergeInput.contact?.contact_id ?? null;
  const identityKey = [organizationId, currentUserId, channel, contactId].join(":");

  const [templates, setTemplates] = useState<MessageTemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<PreviewDraft | null>(null);
  const activePreview = preview?.identityKey === identityKey ? preview : null;

  useEffect(() => {
    if (!open) return;
    if (!organizationId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      // RLS and the explicit query limit to current-org agency + the actor's personal templates.
      let q = supabase
        .from("message_templates")
        .select("id, name, type, subject, content, scope, sms_purpose")
        .eq("organization_id", organizationId)
        .order("name");
      if (currentUserId) {
        q = q.or(`scope.eq.agency,and(scope.eq.personal,created_by.eq.${currentUserId})`);
      } else {
        q = q.eq("scope", "agency");
      }
      const { data, error } = await q;
      if (!cancelled) {
        if (error) {
          console.error(error);
          setTemplates([]);
        } else {
          setTemplates((data || []) as MessageTemplateRow[]);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, organizationId, currentUserId]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setPreview(null);
    }
  }, [open]);

  useEffect(() => { setPreview(null); }, [identityKey]);

  function close() {
    setPreview(null);
    onOpenChange(false);
  }

  function pick(template: MessageTemplateRow) {
    const rawSubject = channel === "email" ? (template.subject?.trim() ?? "") : "";
    const rawBody = template.content ?? "";
    setPreview({
      identityKey,
      template,
      body: applyMessageTemplateMerge(rawBody, mergeInput),
      subject: channel === "email" ? applyMessageTemplateMerge(rawSubject, mergeInput) : "",
      missingFields: unresolvedTemplateFields(
        channel === "email" ? `${rawSubject}\n${rawBody}` : rawBody,
        mergeInput,
      ),
    });
  }

  function apply() {
    if (!activePreview || !activePreview.body.trim()) return;
    onApply({
      body: activePreview.body,
      subject: channel === "email" ? activePreview.subject : null,
      purpose: activePreview.template.sms_purpose,
    });
    close();
    if (activePreview.missingFields.length) {
      toast({
        title: "Check template before sending",
        description: `Missing or unknown fields: ${activePreview.missingFields.slice(0, 4).join(", ")}${activePreview.missingFields.length > 4 ? ` (+${activePreview.missingFields.length - 4} more)` : ""}. Edit your message before sending.`,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setPreview(null); onOpenChange(next); }}>
      <DialogContent
        className="flex min-h-0 max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-4 sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{activePreview ? "Preview & edit template" : "Message templates"}</DialogTitle>
        </DialogHeader>
        {activePreview ? (
          <MessageTemplateEditPreview
            name={activePreview.template.name}
            channel={channel}
            body={activePreview.body}
            subject={activePreview.subject}
            missingFields={activePreview.missingFields}
            hasDraft={hasDraft}
            onBodyChange={(body) => setPreview((prev) => prev?.identityKey === identityKey ? { ...prev, body } : prev)}
            onSubjectChange={(subject) => setPreview((prev) => prev?.identityKey === identityKey ? { ...prev, subject } : prev)}
            onBack={() => setPreview(null)}
            onCancel={close}
            onApply={apply}
          />
        ) : (
          <MessageTemplatePickerList
            templates={templates}
            loading={loading}
            organizationId={organizationId}
            channel={channel}
            search={search}
            onSearchChange={setSearch}
            onPick={pick}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
