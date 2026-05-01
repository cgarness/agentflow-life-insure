import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  applyMessageTemplateMerge,
  templateMatchesChannel,
  type MessageTemplateMergeInput,
} from "@/lib/messageTemplateMerge";

type TemplateRow = {
  id: string;
  name: string;
  type: string | null;
  subject: string | null;
  content: string;
};

export interface MessageTemplatesPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** SMS vs Email tab — only matching template types are listed. */
  channel: "sms" | "email";
  mergeInput: MessageTemplateMergeInput;
  onApply: (payload: { body: string; subject: string | null }) => void;
}

export function MessageTemplatesPickerModal({
  open,
  onOpenChange,
  channel,
  mergeInput,
  onApply,
}: MessageTemplatesPickerModalProps) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("id, name, type, subject, content")
        .order("name");
      if (!cancelled) {
        if (error) {
          console.error(error);
          setTemplates([]);
        } else {
          setTemplates((data || []) as TemplateRow[]);
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const channelFiltered = useMemo(
    () => templates.filter((t) => templateMatchesChannel(t.type, channel)),
    [templates, channel],
  );

  const searchLower = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!searchLower) return channelFiltered;
    return channelFiltered.filter((t) => t.name.toLowerCase().includes(searchLower));
  }, [channelFiltered, searchLower]);

  function handlePick(t: TemplateRow) {
    const trimmedSubject = channel === "email" ? (t.subject?.trim() ?? "") : "";
    onApply({
      body: applyMessageTemplateMerge(t.content ?? "", mergeInput),
      subject: channel === "email" ? (trimmedSubject ? applyMessageTemplateMerge(trimmedSubject, mergeInput) : "") : null,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Message templates</DialogTitle>
          <p className="text-sm font-normal text-muted-foreground">
            Pick a saved template for this {channel === "email" ? "email" : "text"}. Merge fields fill in using the contact
            and your profile when possible.
          </p>
        </DialogHeader>

        <input
          type="search"
          autoComplete="off"
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-accent" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {channelFiltered.length === 0 ? (
                <>
                  No {channel.toUpperCase()} templates yet.
                  <br />
                  Add them under Settings → Email & SMS Templates.
                </>
              ) : (
                <>No templates match your search.</>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border p-1">
              {visible.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(t)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium text-foreground">{t.name}</span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                      {t.type || "Any"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
