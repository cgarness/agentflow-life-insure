import { applyMergeSamples } from "@/components/settings/templateMergeData";

interface TemplatePreviewPanelProps {
  type: "email" | "sms";
  subject: string;
  content: string;
}

export function TemplatePreviewPanel({ type, subject, content }: TemplatePreviewPanelProps) {
  const body = applyMergeSamples(content);
  const subjectLine = applyMergeSamples(subject);

  return (
    <div className="space-y-4 py-1">
      {type === "email" ? (
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="space-y-1 border-b pb-3 text-sm">
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">From:</span>
              <span className="font-medium text-foreground">Marcus Rivera &lt;marcus@agencyflow.com&gt;</span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">To:</span>
              <span className="text-foreground">Jane Smith &lt;jane.smith@email.com&gt;</span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 shrink-0 text-muted-foreground">Subject:</span>
              <span className="font-medium text-foreground">{subjectLine || "(No subject)"}</span>
            </div>
          </div>
          <div className="whitespace-pre-wrap bg-background/80 pt-3 text-sm leading-relaxed text-foreground">{body}</div>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">SMS Preview</p>
          <div className="max-w-[75%] rounded-2xl bg-zinc-900 px-3 py-2.5 font-mono text-sm leading-snug text-zinc-50 dark:bg-zinc-950">
            {body}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Sample data only — not real contact info</p>
    </div>
  );
}
