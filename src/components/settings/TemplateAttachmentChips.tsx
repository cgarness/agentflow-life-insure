import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { TemplateAttachment } from "@/components/settings/messageTemplateTypes";
import { TEMPLATE_ATTACHMENTS_BUCKET } from "@/components/settings/templateAttachmentUtils";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

interface TemplateAttachmentChipsProps {
  attachments: TemplateAttachment[];
  onRemove: (storagePath: string) => void;
}

export function TemplateAttachmentChips({ attachments, onRemove }: TemplateAttachmentChipsProps) {
  const [signedByPath, setSignedByPath] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        attachments.map(async (a) => {
          const { data } = await supabase.storage
            .from(TEMPLATE_ATTACHMENTS_BUCKET)
            .createSignedUrl(a.url, 3600);
          return [a.url, data?.signedUrl ?? ""] as const;
        }),
      );
      if (!cancelled) setSignedByPath(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {attachments.map((a) => (
        <div
          key={a.url}
          className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs text-foreground"
        >
          {signedByPath[a.url] ? (
            <a
              href={signedByPath[a.url]}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[180px] truncate text-primary underline-offset-2 hover:underline"
            >
              {a.name}
            </a>
          ) : (
            <span className="max-w-[180px] truncate">{a.name}</span>
          )}
          <span className="text-muted-foreground">{formatBytes(a.size)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(a.url)}
            aria-label={`Remove ${a.name}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
