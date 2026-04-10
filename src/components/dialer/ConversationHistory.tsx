import React, { useMemo, useState } from "react";
import { MessageSquare, Phone, Pencil, Activity, Mail, FileText, Send, Mic, Play } from "lucide-react";
import { HistorySkeleton } from "./DialerSkeletons";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";

interface HistoryItem {
  id: string;
  type: string;
  description: string;
  direction?: "inbound" | "outbound" | null;
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
  const [expandedRecordings, setExpandedRecordings] = useState<Record<string, boolean>>({});

  const toggleRecording = (id: string) => {
    setExpandedRecordings(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
            reversedHistory.map((item) => {
              const isOutbound = item.direction !== "inbound";
              
              return (
                <div 
                  key={item.id} 
                  className={`flex flex-col ${isOutbound ? "items-end" : "items-start"} w-full group`}
                >
                  <div className={`flex items-end gap-2 max-w-[85%] ${isOutbound ? "flex-row-reverse" : "flex-row"}`}>
                    {/* Minimalist Icon Indicator */}
                    <div className={`shrink-0 mb-1 opacity-40 group-hover:opacity-100 transition-opacity`}>
                      {historyIcon(item.type)}
                    </div>

                    <div className="flex flex-col">
                      <div 
                        className={`px-3.5 py-2 rounded-2xl text-sm shadow-sm transition-all relative ${
                          isOutbound 
                            ? "bg-[#007AFF] text-white rounded-tr-sm" 
                            : "bg-[#E9E9EB] dark:bg-[#262629] text-foreground rounded-tl-sm"
                        }`}
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="leading-tight font-medium">{item.description}</span>
                            {item.type === "call" && item.recording_url && (
                              <button 
                                onClick={() => toggleRecording(item.id)}
                                className={`p-1 rounded-full transition-colors ${
                                  isOutbound ? "hover:bg-white/20 text-white" : "hover:bg-black/10 text-primary"
                                }`}
                                title={expandedRecordings[item.id] ? "Hide Recording" : "Play Recording"}
                              >
                                <Play className={`w-3.5 h-3.5 ${expandedRecordings[item.id] ? "fill-current" : ""}`} />
                              </button>
                            )}
                          </div>
                          
                          {item.type === "call" && item.disposition && (
                            <div className="flex justify-start">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                  isOutbound ? "bg-white/20 text-white" : "bg-black/10 text-foreground/70"
                                }`}
                                style={!isOutbound && item.disposition_color ? {
                                  backgroundColor: `${item.disposition_color}22`,
                                  color: item.disposition_color
                                } : undefined}
                              >
                                {item.disposition}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Integrated Recording Player */}
                        {item.type === "call" && item.recording_url && expandedRecordings[item.id] && (
                          <div className={`mt-3 pt-3 border-t ${isOutbound ? "border-white/20" : "border-black/10"} animate-in fade-in slide-in-from-top-1 duration-200`}>
                            <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest mb-2 ${isOutbound ? "text-white/70" : "text-muted-foreground"}`}>
                              <Mic className="w-2.5 h-2.5" aria-hidden />
                              <span>Recording</span>
                            </div>
                            <RecordingPlayer callId={item.id} compact />
                          </div>
                        )}
                      </div>
                      
                      {/* Timestamp */}
                      <div className={`text-[10px] text-muted-foreground mt-1 px-1 flex items-center gap-1 ${isOutbound ? "justify-end" : "justify-start"}`}>
                        {formatDateTime(new Date(item.created_at))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
