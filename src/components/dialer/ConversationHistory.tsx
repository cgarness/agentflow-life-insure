import React, { useMemo } from "react";
import { MessageSquare, Phone, Pencil, Activity, Mail, FileText, Send } from "lucide-react";
import { HistorySkeleton } from "./DialerSkeletons";

interface HistoryItem {
  id: string;
  type: string;
  description: string;
  disposition?: string | null;
  disposition_color?: string | null;
  created_at: string;
  recording_url?: string | null;
  duration?: number | null;
}

interface ConversationHistoryProps {
  history: HistoryItem[];
  loadingHistory: boolean;
  formatDateTime: (date: Date) => string;
  smsTab: "sms" | "email";
  messageText: string;
  subjectText: string;
  selectedCallerNumber: string;
  availableNumbers: any[];
  onSmsTabChange: (tab: "sms" | "email") => void;
  onOpenTemplates: () => void;
  onSendMessage: () => void;
  onMessageChange: (text: string) => void;
  onSubjectChange: (text: string) => void;
  onCallerNumberChange: (num: string) => void;
  historyEndRef?: React.RefObject<HTMLDivElement>;
}

function historyIcon(type: string) {
  switch (type) {
    case "call":
      return <Phone className="w-3.5 h-3.5 text-muted-foreground" />;
    case "note":
      return <Pencil className="w-3.5 h-3.5 text-muted-foreground" />;
    case "status":
      return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
    case "sms":
      return <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />;
    case "email":
      return <Mail className="w-3.5 h-3.5 text-muted-foreground" />;
    default:
      return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  history,
  loadingHistory,
  formatDateTime,
  smsTab,
  messageText,
  subjectText,
  selectedCallerNumber,
  availableNumbers,
  onSmsTabChange,
  onOpenTemplates,
  onSendMessage,
  onMessageChange,
  onSubjectChange,
  onCallerNumberChange,
  historyEndRef,
}) => {
  // Reverse history so newest is index 0 for flex-col-reverse anchoring
  const reversedHistory = useMemo(() => [...history].reverse(), [history]);

  return (
    <div className="flex-[1.5] flex flex-col overflow-hidden min-h-0 h-full">
      <div className="flex flex-col flex-1 overflow-hidden bg-card border rounded-xl">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">Conversation History</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 bg-accent/30 rounded-lg border border-border">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">From:</span>
            <select
              value={selectedCallerNumber}
              onChange={(e) => onCallerNumberChange(e.target.value)}
              className="bg-transparent border-none text-xs font-semibold text-foreground focus:ring-0 p-0 h-auto cursor-pointer outline-none transition-all"
            >
              <option value="">AI Local Presence</option>
              {availableNumbers.map(n => (
                <option key={n.phone_number} value={n.phone_number}>
                  {n.friendly_name ? `${n.friendly_name} - ` : ''}{n.phone_number}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable feed — uses flex-col-reverse to anchor to bottom (chat style) */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col-reverse gap-3">
          {/* Anchor div — first child in flex-col-reverse renders at visual bottom */}
          <div ref={historyEndRef} />

          {loadingHistory && <HistorySkeleton />}

          {!loadingHistory && history.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-6">No activity yet</p>
          )}

          {!loadingHistory &&
            reversedHistory.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0">
                  {historyIcon(item.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground">{item.description}</span>
                    {item.type === "call" && item.disposition && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: item.disposition_color
                            ? `${item.disposition_color}33`
                            : undefined,
                          color: item.disposition_color ?? undefined,
                        }}
                      >
                        {item.disposition}
                      </span>
                    )}
                  </div>
                  {item.type === "call" && item.recording_url && (
                    <audio controls className="w-full h-8 mt-1.5" preload="none">
                      <source src={item.recording_url} type="audio/mpeg" />
                    </audio>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatDateTime(new Date(item.created_at))}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* SMS composer — shrink-0, fixed at bottom */}
      <div className="shrink-0 bg-card border rounded-xl flex flex-col mt-3">
        <div className="px-4 pt-3">
          {smsTab === "email" ? (
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
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t mt-3">
          <div className="flex gap-1">
            {(["sms", "email"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => onSmsTabChange(tab)}
                className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                  smsTab === tab
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenTemplates}
              className="bg-accent text-muted-foreground border border-border rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/80 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Templates
            </button>

            <button
              onClick={onSendMessage}
              className="bg-success text-success-foreground rounded-lg px-4 py-1.5 text-xs font-bold flex items-center gap-2 hover:bg-success/90 transition-all shadow-sm border border-success/20"
              title={smsTab === "email" ? "Send Email" : "Send SMS"}
            >
              <span>Send</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
