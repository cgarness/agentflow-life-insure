import { useLayoutEffect, useRef, useState } from "react";
import { FileText, Send, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MessageComposePanelProps {
  channel: "sms" | "email";
  onChannelChange: (channel: "sms" | "email") => void;
  messageText: string;
  onMessageChange: (text: string) => void;
  subjectText: string;
  onSubjectChange: (text: string) => void;
  onOpenTemplates: () => void;
  onSendMessage: () => void;
  sendDisabled?: boolean;
  sendLoading?: boolean;
  className?: string;
  smsOnly?: boolean;
}

/** Shared SMS/email composer: compact at rest, grows with text, bounded by the viewport. */
export function MessageComposePanel({
  channel, onChannelChange, messageText, onMessageChange, subjectText, onSubjectChange,
  onOpenTemplates, onSendMessage, sendDisabled, sendLoading, className, smsOnly = false,
}: MessageComposePanelProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Only editor height is managed imperatively; all presentation uses Tailwind.
    // CSS max-height below remains the authority on short/mobile viewports.
    editor.style.height = "auto";
    const maxHeight = expanded ? 360 : 184;
    editor.style.height = `${Math.max(expanded ? 132 : 76, Math.min(editor.scrollHeight, maxHeight))}px`;
  }, [messageText, channel, expanded]);

  return (
    <div className={cn("shrink-0 rounded-xl border bg-card flex flex-col", className)}>
      <div className="space-y-2 px-3 pt-3 sm:px-4">
        {channel === "email" && (
          <input
            aria-label="Email subject"
            value={subjectText}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="Subject"
            className="w-full rounded-lg border border-border bg-accent px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        )}
        <div className="relative">
          <textarea
            ref={editorRef}
            rows={2}
            aria-label={channel === "sms" ? "SMS message" : "Email message"}
            value={messageText}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder={channel === "sms" ? "Type SMS message…" : "Type EMAIL message…"}
            className={cn(
              "block w-full min-h-[76px] max-h-[184px] resize-none overflow-y-auto rounded-lg border border-border bg-accent px-3 py-2 pr-10 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary",
              expanded && "min-h-[132px] max-h-[min(40dvh,360px)]",
            )}
            onKeyDown={(e) => {
              if (channel !== "sms" || e.key !== "Enter" || e.shiftKey ||
                  e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              if (!sendDisabled && !sendLoading) onSendMessage();
            }}
          />
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={expanded ? "Collapse message editor" : "Expand message editor"}
            title={expanded ? "Collapse editor" : "Expand editor"}
            className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t px-3 py-3 sm:px-4">
        <div className="flex w-fit shrink-0 rounded-lg bg-muted p-0.5">
          {(smsOnly ? ["sms"] as const : ["sms", "email"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onChannelChange(tab)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-tight transition-all sm:px-4",
                channel === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenTemplates}
            className="flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/80"
          >
            <FileText className="h-3.5 w-3.5" />
            Templates
          </button>
          <button
            type="button"
            onClick={onSendMessage}
            disabled={sendDisabled || sendLoading}
            className="flex items-center gap-2 rounded-lg border border-success/20 bg-success px-4 py-1.5 text-xs font-bold text-success-foreground shadow-sm transition-all hover:bg-success/90 disabled:pointer-events-none disabled:opacity-50"
            title={channel === "email" ? "Send Email" : "Send SMS"}
          >
            <span>Send</span>
            {sendLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
