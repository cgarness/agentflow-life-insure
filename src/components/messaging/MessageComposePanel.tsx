import { FileText, Send, Loader2 } from "lucide-react";
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
}

/**
 * Matches the dialer conversation compose bar: SMS/EMAIL pills, Templates, green Send,
 * accent inputs — used by ConversationHistory and contact full view.
 */
export function MessageComposePanel({
  channel,
  onChannelChange,
  messageText,
  onMessageChange,
  subjectText,
  onSubjectChange,
  onOpenTemplates,
  onSendMessage,
  sendDisabled,
  sendLoading,
  className,
}: MessageComposePanelProps) {
  return (
    <div className={cn("shrink-0 bg-card border rounded-xl flex flex-col", className)}>
      <div className="px-4 pt-3">
        {channel === "email" ? (
          <div className="flex flex-col gap-2">
            <input
              value={subjectText}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder="Subject"
              className="bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground w-full focus:ring-1 focus:ring-primary outline-none"
            />
            <textarea
              value={messageText}
              onChange={(e) => onMessageChange(e.target.value)}
              placeholder="Type EMAIL message…"
              className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none h-20 focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
        ) : (
          <div className="text-foreground">
            <input
              value={messageText}
              onChange={(e) => onMessageChange(e.target.value)}
              placeholder="Type SMS message…"
              className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!sendDisabled && !sendLoading) onSendMessage();
                }
              }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t mt-3">
        <div className="flex bg-muted rounded-lg p-0.5 w-fit mb-3">
          {(["sms", "email"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => onChannelChange(tab)}
              className={cn(
                "px-4 py-1.5 rounded-md text-[11px] font-bold transition-all uppercase tracking-tight",
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
            className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/80 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Templates
          </button>

          <button
            type="button"
            onClick={onSendMessage}
            disabled={sendDisabled || sendLoading}
            className="bg-success text-success-foreground rounded-lg px-4 py-1.5 text-xs font-bold flex items-center gap-2 hover:bg-success/90 transition-all shadow-sm border border-success/20 disabled:opacity-50 disabled:pointer-events-none"
            title={channel === "email" ? "Send Email" : "Send SMS"}
          >
            <span>Send</span>
            {sendLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
