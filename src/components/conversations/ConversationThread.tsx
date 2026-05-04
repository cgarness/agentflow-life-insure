import React, { useState, useEffect, useRef, useMemo } from "react";
import { MessageSquare, Mail, Phone, Info, MoreVertical, Send, Loader2, Play, Mic, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { messagesSupabaseApi } from "@/lib/supabase-messages";
import { MessageComposePanel } from "@/components/messaging/MessageComposePanel";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
import { isCallsRowInboundDirection } from "@/lib/webrtcInboundCaller";
import { format } from "date-fns";

interface ConversationThreadProps {
  contactId: string;
  contactName: string;
  contactType: string;
  onSendMessage: (text: string, channel: "sms" | "email", subject?: string) => Promise<void>;
  sending?: boolean;
}

const ConversationThread: React.FC<ConversationThreadProps> = ({
  contactId,
  contactName,
  contactType,
  onSendMessage,
  sending = false,
}) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [expandedRecordings, setExpandedRecordings] = useState<Record<string, boolean>>({});
  const [expandedEmails, setExpandedEmails] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contactId) {
      loadThread();

      const channel = supabase
        .channel(`thread-${contactId}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'messages',
          filter: `lead_id=eq.${contactId}`
        }, () => loadThread())
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'contact_emails',
          filter: `contact_id=eq.${contactId}`
        }, () => loadThread())
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [contactId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadThread = async () => {
    setLoading(true);
    try {
      const data = await messagesSupabaseApi.getConversationThread(contactId);
      setMessages(data);
    } catch (err) {
      console.error("Error loading thread:", err);
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = async () => {
    if (!messageText.trim()) return;
    await onSendMessage(messageText, channel, subjectText);
    setMessageText("");
    setSubjectText("");
    // Optimistically update or reload
    loadThread();
  };

  const toggleRecording = (id: string) => {
    setExpandedRecordings(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEmail = (id: string) => {
    setExpandedEmails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const historyIcon = (type: string) => {
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
      default:
        return (
          <div className="w-6 h-6 rounded-full flex items-center justify-center bg-muted">
            <Info className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        );
    }
  };

  const renderMessage = (item: any) => {
    const isOutbound = item.type !== "call" ? item.direction !== "inbound" : !isCallsRowInboundDirection(item.direction);
    const formatDateTime = (date: Date) => format(date, "M/d/yyyy h:mm a");

    if (item.type === "email") {
      const isExpanded = expandedEmails[item.id] ?? false;
      const emailBody = item.body || item.description || "";
      const bodyLines = emailBody.split('\n');
      return (
        <div key={item.id} className="flex flex-col w-full mb-4">
          <div className="bg-card border border-violet-400/20 rounded-xl overflow-hidden shadow-sm max-w-[85%] mr-auto">
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
              <div className="px-3.5 pb-3 pt-2.5 border-t border-border/50 animate-in fade-in slide-in-from-top-1 duration-200 bg-accent/10">
                {bodyLines.map((line: string, i: number) =>
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
            {formatDateTime(new Date(item._ts || item.created_at))}
          </div>
        </div>
      );
    }

    return (
      <div
        key={item.id}
        className={`flex flex-col ${isOutbound ? "items-end" : "items-start"} w-full group mb-4`}
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
                      : item.type === "sms" 
                        ? (isOutbound ? "SMS Sent" : "SMS Received")
                        : item.type}
                  </span>
                  
                  {item.type === "call" && item.disposition_name && (
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        isOutbound ? "bg-white/20 text-white" : "bg-black/10 text-foreground/70"
                      } shadow-sm`}
                    >
                      {item.disposition_name}
                    </span>
                  )}

                  {item.type === "call" && (
                    <span className={`text-[11px] font-medium opacity-80 ${isOutbound ? "text-white" : "text-muted-foreground"}`}>
                      {item.duration ? `${Math.floor(item.duration/60)}:${String(item.duration%60).padStart(2,'0')}` : '0:00'}
                    </span>
                  )}

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
                
                {item.type === "sms" && (
                  <div className="whitespace-pre-wrap leading-relaxed">{item.body || item.description}</div>
                )}
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
              {formatDateTime(new Date(item._ts || item.created_at))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
      {/* Thread Header */}
      <div className="h-16 border-b border-border px-6 flex items-center justify-between bg-card/30 backdrop-blur-sm z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shadow-inner">
            {contactName.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <h2 className="font-bold text-sm text-foreground">{contactName}</h2>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider",
                contactType === 'lead' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                contactType === 'client' ? 'bg-green-500/10 text-green-500 border border-green-500/20' :
                'bg-orange-500/10 text-orange-500 border border-orange-500/20'
              )}>
                {contactType}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Online</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-accent rounded-full text-muted-foreground transition-colors">
            <Info className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-accent rounded-full text-muted-foreground transition-colors">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin opacity-20" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40 grayscale">
            <MessageSquare className="w-16 h-16 mb-4" />
            <h3 className="text-lg font-bold">No messages yet</h3>
            <p className="text-sm max-w-[200px]">Start the conversation by sending an SMS or Email below.</p>
          </div>
        ) : (
          <>
            {messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Composer Area */}
      <div className="p-6 pt-0">
        <MessageComposePanel
          channel={channel}
          onChannelChange={setChannel}
          messageText={messageText}
          onMessageChange={setMessageText}
          subjectText={subjectText}
          onSubjectChange={setSubjectText}
          onOpenTemplates={() => {}} // TODO: Templates
          onSendMessage={handleSend}
          sendLoading={sending}
          className="shadow-2xl shadow-primary/5 border-primary/10"
        />
      </div>
    </div>
  );
};

export default ConversationThread;
