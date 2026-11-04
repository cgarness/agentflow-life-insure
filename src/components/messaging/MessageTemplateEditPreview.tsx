import { z } from "zod";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

const previewSchema = z.object({
  body: z.string().trim().min(1),
  subject: z.string(),
});

interface MessageTemplateEditPreviewProps {
  name: string;
  channel: "sms" | "email";
  body: string;
  subject: string;
  missingFields: string[];
  hasDraft: boolean;
  onBodyChange: (next: string) => void;
  onSubjectChange: (next: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function MessageTemplateEditPreview({
  name, channel, body, subject, missingFields, hasDraft,
  onBodyChange, onSubjectChange, onBack, onCancel, onApply,
}: MessageTemplateEditPreviewProps) {
  const canApply = previewSchema.safeParse({ body, subject }).success;

  return (
    <>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={name}>{name}</span>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
            {channel}
          </span>
        </div>
        {channel === "email" && (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Subject
            <input
              value={subject}
              onChange={(event) => onSubjectChange(event.target.value)}
              className="w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
        )}
        <label className="flex min-h-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Edit message
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            rows={8}
            className="min-h-36 max-h-[42dvh] w-full resize-y overflow-y-auto rounded-lg border border-border bg-accent px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        {missingFields.length > 0 && (
          <p role="alert" className="text-xs text-destructive">
            Missing or unknown template fields: {missingFields.join(", ")}. Review the message before using.
          </p>
        )}
        {hasDraft && (
          <p className="text-xs text-muted-foreground">
            Using this template replaces your current draft.
          </p>
        )}
      </div>
      <DialogFooter className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        <Button type="button" variant="outline" onClick={onBack}>Back</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" onClick={onApply} disabled={!canApply}>Use Template</Button>
      </DialogFooter>
    </>
  );
}
