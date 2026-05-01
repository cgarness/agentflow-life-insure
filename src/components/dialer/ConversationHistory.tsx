import React, { useMemo, useState } from "react";
import { MessageSquare, Phone, Pencil, Activity, Mail, Mic, Play, ChevronDown } from "lucide-react";
import { HistorySkeleton } from "./DialerSkeletons";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { isCallsRowInboundDirection } from "@/lib/webrtcInboundCaller";
import { MessageComposePanel } from "@/components/messaging/MessageComposePanel";
import type { UserEmailConnection } from "@/lib/supabase-email";

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
  subject?: string | null;
  from_email?: string | null;
  body?: string | null;
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
  emailConnections: UserEmailConnection[];
  selectedEmailConnectionId: string;
  onEmailConnectionChange: (id: string) => void;
}

function historyIcon(type: string) {
  switch (type) {
    case "call":
      return (
        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-emerald-500/10">
          <Phone className="w-3.5 h-3.5 text-emerald-500" />
        </div>
      );
    case "sms":
      return (
        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-blue-400/10">
          <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
        </div>
      );
    case "email":
      return (
        <div className="w-6 h-6 rounded-full flex items-center justify-center bg-violet-400/10">
          <Mail className="w-3.5 h-3.5 text-violet-400" />
        </div>
      );
    case "note":
      return <Pencil className="w-3.5 h-3.5 text-muted-foreground" />;
    case "status":
      return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
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
  emailConnections,
  selectedEmailConnectionId,
  onEmailConnectionChange,
}) => {
  const [expandedRecordings, setExpandedRecordings] = useState<Record<string, boolean>>({});
  const [expandedEmails, setExpandedEmails] = useState<Record<string, boolean>>({});

  const toggleRecording = (id: string) => {
    setExpandedRecordings(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEmail = (id: string) => {
    setExpandedEmails(prev => ({ ...prev, [id]: !prev[id] }));
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
          <div className="flex items-center gap-2 px-2 py-1 bg-accent/30 rounded-lg border border-border min-w-0 max-w-[min(100%,280px)]">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider shrink-0">From:</span>
            {smsTab === "email" ? (
              <select
                value={selectedEmailConnectionId}
                onChange={(e) => onEmailConnectionChange(e.target.value)}
                className="bg-transparent border-none text-xs font-semibold text-foreground focus:ring-0 p-0 h-auto cursor-pointer outline-none transition-all truncate min-w-0 flex-1"
                title={
                  emailConnections.find((c) => c.id === selectedEmailConnectionId)?.provider_account_email || ""
                }
              >
                {emailConnections.length === 0 ? (
                  <option value="">No inbox connected</option>
                ) : (
                  emailConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.provider_account_email}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <select
                value={selectedCallerNumber}
                onChange={(e) => onCallerNumberChange(e.target.value)}
                className="bg-transparent border-none text-xs font-semibold text-foreground focus:ring-0 p-0 h-auto cursor-pointer outline-none transition-all min-w-0 flex-1"
              >
                <option value="">AI Local Presence</option>
                {availableNumbers.map((n) => (
                  <option key={n.phone_number} value={n.phone_number}>
                    {n.friendly_name ? `${n.friendly_name} - ` : ""}
                    {n.phone_number}
                  </option>
                ))}
              </select>
            )}
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
              const isOutbound =
                item.type !== "call" ? item.direction !== "inbound" : !isCallsRowInboundDirection(item.direction);

              if (item.type === "email") {
                const isExpanded = expandedEmails[item.id] ?? false;
                const emailBody = item.body || item.description || "";
                const bodyLines = emailBody.split('\n');
                return (
                  <div key={item.id} className="flex flex-col w-full">
                    <div className="bg-card border border-violet-400/20 rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => toggleEmail(item.id)}
                        className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-accent/40 transition-colors"
                      >
                        <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-violet-400/10">
                          <Mail className="w-3.5 h-3.5 text-violet-400" />
                        </div>
                        <span className="text-[11px] font-semibold text-violet-400 shrink-0">
                          {isOutbound ? "Sent" : "Received"}
                        </span>
                        <span className="flex-1 text-sm font-medium text-foreground truncate min-w-0">
                          {item.subject || item.description || "(No subject)"}
                        </span>
                        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      {isExpanded && (
                        <div className="px-3.5 pb-3 pt-2.5 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200">
                          {bodyLines.map((line, i) =>
                            line.startsWith('>') ? (
                              <p key={i} className="text-[11px] text-muted-foreground leading-relaxed">{line}</p>
                            ) : (
                              <p key={i} className="text-sm text-foreground leading-relaxed">{line}</p>
                            )
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 px-1">
                      {formatDateTime(new Date(item.created_at))}
                    </div>
                  </div>
                );
              }

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
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="leading-tight font-semibold shrink-0">
                              {item.type === "call"
                                ? isCallsRowInboundDirection(item.direction)
                                  ? "Inbound Call"
                                  : "Outbound Call"
                                : item.direction === "inbound"
                                  ? "Inbound Call"
                                  : "Call"}
                            </span>
                            
                            {item.type === "call" && item.disposition && (
                              <span
                                className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                  isOutbound ? "bg-white/20 text-white" : "bg-black/10 text-foreground/70"
                                } shadow-sm`}
                                style={!isOutbound && item.disposition_color ? {
                                  backgroundColor: `${item.disposition_color}22`,
                                  color: item.disposition_color
                                } : undefined}
                              >
                                {item.disposition}
                              </span>
                            )}

                            <span className={`text-[11px] font-medium opacity-80 ${isOutbound ? "text-white" : "text-muted-foreground"}`}>
                              {item.duration ? `${Math.floor(item.duration/60)}:${String(item.duration%60).padStart(2,'0')}` : '0:00'}
                            </span>

                            {item.type === "call" && item.recording_url && (
                              <button 
                                onClick={(e) => { e.stopPropagation(); toggleRecording(item.id); }}
                                className={`p-1 rounded-full transition-all ml-auto ${
                                  isOutbound ? "hover:bg-white/30 text-white" : "hover:bg-primary/10 text-primary"
                                }`}
                                title={expandedRecordings[item.id] ? "Hide Recording" : "Play Recording"}
                              >
                                <Play className={`w-3.5 h-3.5 ${expandedRecordings[item.id] ? "fill-current" : ""}`} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Integrated Recording Player */}
                        {item.type === "call" && item.recording_url && expandedRecordings[item.id] && (
                          <div className={`mt-3 pt-3 border-t ${isOutbound ? "border-white/30" : "border-border/30"} animate-in fade-in slide-in-from-top-1 duration-200`}>
                            <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest mb-3 ${isOutbound ? "text-white" : "text-foreground"}`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isOutbound ? "bg-white/20" : "bg-primary/10"}`}>
                                <Mic className="w-3 h-3 text-current" aria-hidden />
                              </div>
                              <span>Call Recording</span>
                            </div>
                            <div className={`rounded-xl p-3 ${isOutbound ? "bg-white/10" : "bg-accent/50"} border ${isOutbound ? "border-white/20" : "border-border/50"}`}>
                              <RecordingPlayer callId={item.id} compact />
                            </div>
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

      <MessageComposePanel
        className="mt-3"
        channel={smsTab}
        onChannelChange={onSmsTabChange}
        messageText={messageText}
        onMessageChange={onMessageChange}
        subjectText={subjectText}
        onSubjectChange={onSubjectChange}
        onOpenTemplates={onOpenTemplates}
        onSendMessage={onSendMessage}
      />
    </div>
  );
};
