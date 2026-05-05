import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Mail, Phone, Info, MoreVertical, Play, Mic, ChevronDown, Loader2 } from "lucide-react";
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
    loadThread();
  };

  const toggleRecording = (id: string) => {
    setExpandedRecordings(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEmail = (id: string) => {
    setExpandedEmails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderIcon = (type: string, isOutbound: boolean) => {
    const iconCls = "w-3 h-3 opacity-40";
    switch (type) {
      case "call": return <Phone className={cn(iconCls, "text-emerald-500")} />;
      case "sms": return <MessageSquare className={cn(iconCls, "text-blue-500")} />;
      case "email": return <Mail className={cn(iconCls, "text-violet-500")} />;
      default: return null;
    }
  };

  const renderMessage = (item: any) => {
    const isOutbound = item.type !== "call" ? item.direction !== "inbound" : !isCallsRowInboundDirection(item.direction);
    const ts = item._ts || new Date(item.created_at).getTime();
    const timeStr = format(new Date(ts), "MM/dd/yyyy h:mm a");

    if (item.type === "email") {
      const isExpanded = expandedEmails[item.id] ?? false;
      const body = item.body_text || item.body || item.description || "";
      
      return (
        <div key={item.id} className={cn("flex flex-col mb-4", isOutbound ? "items-end" : "items-start")}>
          <div className={cn("flex items-end gap-2", isOutbound ? "flex-row-reverse" : "flex-row")}>
            <div className="mb-2">{renderIcon("email", isOutbound)}</div>
            <div className="flex flex-col">
              <button 
                onClick={() => toggleEmail(item.id)}
                className={cn(
                  "px-4 py-2 rounded-2xl text-sm shadow-sm flex items-center gap-2 transition-all",
                  isOutbound 
                    ? "bg-[#007AFF] text-white rounded-tr-sm" 
                    : "bg-[#E9E9EB] dark:bg-[#262629] text-foreground rounded-tl-sm"
                )}
              >
                <span className="font-semibold">{item.subject || "(No Subject)"}</span>
                <ChevronDown className={cn("w-3.5 h-3.5 opacity-70 transition-transform", isExpanded && "rotate-180")} />
              </button>
              {isExpanded && (
                <div className={cn(
                  "mt-2 p-4 rounded-2xl text-sm border bg-card shadow-lg max-w-lg z-10 animate-in fade-in slide-in-from-top-1",
                  isOutbound ? "mr-0" : "ml-0"
                )}>
                  <div className="whitespace-pre-wrap leading-relaxed text-foreground/90">{body}</div>
                </div>
              )}
              <div className={cn("text-[10px] text-muted-foreground mt-1 px-1", isOutbound ? "text-right" : "text-left")}>
                {timeStr}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={item.id} className={cn("flex flex-col mb-4", isOutbound ? "items-end" : "items-start")}>
        <div className={cn("flex items-end gap-2", isOutbound ? "flex-row-reverse" : "flex-row")}>
          <div className="mb-2">{renderIcon(item.type, isOutbound)}</div>
          <div className="flex flex-col">
            <div className={cn(
              "px-4 py-2 rounded-2xl text-sm shadow-sm transition-all",
              isOutbound 
                ? "bg-[#007AFF] text-white rounded-tr-sm" 
                : "bg-[#E9E9EB] dark:bg-[#262629] text-foreground rounded-tl-sm"
            )}>
              {item.type === "call" ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {isCallsRowInboundDirection(item.direction) ? "Inbound Call" : "Outbound Call"}
                    </span>
                    <span className="opacity-70 font-medium">
                      {item.duration ? `${Math.floor(item.duration/60)}:${String(item.duration%60).padStart(2,'0')}` : '0:00'}
                    </span>
                    {item.recording_url && (
                      <button 
                        onClick={() => toggleRecording(item.id)}
                        className={cn("p-1 rounded-full transition-all", isOutbound ? "hover:bg-white/20" : "hover:bg-black/5")}
                      >
                        <Play className={cn("w-3.5 h-3.5", expandedRecordings[item.id] && "fill-current")} />
                      </button>
                    )}
                  </div>
                  {item.disposition_name && (
                    <div className={cn(
                      "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md w-fit",
                      isOutbound ? "bg-white/20" : "bg-black/5 text-muted-foreground"
                    )}>
                      {item.disposition_name}
                    </div>
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap leading-relaxed">{item.body || item.description}</div>
              )}

              {item.type === "call" && item.recording_url && expandedRecordings[item.id] && (
                <div className={cn("mt-3 pt-3 border-t", isOutbound ? "border-white/20" : "border-border/30")}>
                   <RecordingPlayer callId={item.id} compact />
                </div>
              )}
            </div>
            <div className={cn("text-[10px] text-muted-foreground mt-1 px-1", isOutbound ? "text-right" : "text-left")}>
              {timeStr}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-background relative overflow-hidden min-h-0">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin opacity-20" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40 grayscale">
            <MessageSquare className="w-16 h-16 mb-4" />
            <h3 className="text-lg font-bold">No messages yet</h3>
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
          onOpenTemplates={() => {}}
          onSendMessage={handleSend}
          sendLoading={sending}
          className="shadow-xl border-primary/10"
        />
      </div>
    </div>
  );
};

export default ConversationThread;
