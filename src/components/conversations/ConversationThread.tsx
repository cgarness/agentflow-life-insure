import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Mail, Phone, Info, MoreVertical, Send, Loader2, Play, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { messagesSupabaseApi } from "@/lib/supabase-messages";
import { MessageComposePanel } from "@/components/messaging/MessageComposePanel";
import { RecordingPlayer } from "@/components/ui/RecordingPlayer";
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

  const renderMessage = (msg: any) => {
    const isOutbound = msg.direction === "outbound";
    const type = msg._type; // sms, email, call

    if (type === "call") {
      return (
        <div key={msg.id} className="flex justify-center my-4">
          <div className="bg-muted/50 border border-border rounded-full px-4 py-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Phone className="w-3 h-3" />
            <span className="font-medium">{msg.direction === 'inbound' ? 'Inbound' : 'Outbound'} Call</span>
            <span className="opacity-50">•</span>
            <span>{msg.disposition_name || 'No Disposition'}</span>
            <span className="opacity-50">•</span>
            <span>{msg.duration ? `${Math.floor(msg.duration / 60)}:${String(msg.duration % 60).padStart(2, '0')}` : '0:00'}</span>
            {msg.recording_url && (
              <button 
                onClick={() => toggleRecording(msg.id)}
                className="ml-2 p-1 hover:bg-accent rounded-full transition-colors text-primary"
              >
                <Play className="w-3 h-3 fill-current" />
              </button>
            )}
          </div>
          {expandedRecordings[msg.id] && msg.recording_url && (
            <div className="w-full max-w-md mt-2 p-3 bg-card border border-border rounded-xl shadow-sm">
               <RecordingPlayer callId={msg.id} compact />
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={msg.id}
        className={cn(
          "flex flex-col mb-4 max-w-[80%]",
          isOutbound ? "ml-auto items-end" : "mr-auto items-start"
        )}
      >
        <div
          className={cn(
            "px-4 py-2.5 rounded-2xl text-sm relative group transition-all",
            isOutbound
              ? "bg-primary text-primary-foreground rounded-tr-sm shadow-md"
              : "bg-card border border-border text-foreground rounded-tl-sm shadow-sm"
          )}
        >
          {type === 'email' && msg.subject && (
            <div className="font-bold text-[10px] uppercase tracking-wider mb-1 opacity-70">
              Subject: {msg.subject}
            </div>
          )}
          <div className="whitespace-pre-wrap leading-relaxed">{msg.body || msg.body_text || msg.description}</div>
          
          <div className={cn(
            "text-[10px] mt-1.5 opacity-60 flex items-center gap-1",
            isOutbound ? "text-primary-foreground/80" : "text-muted-foreground"
          )}>
            {type === 'sms' ? <MessageSquare className="w-2.5 h-2.5" /> : <Mail className="w-2.5 h-2.5" />}
            {format(new Date(msg._ts), "h:mm a")}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
      {/* Thread Header */}
      <div className="h-16 border-b border-border px-6 flex items-center justify-between bg-card/30 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
            {contactName.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </div>
          <div>
            <h2 className="font-bold text-sm text-foreground">{contactName}</h2>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider",
                contactType === 'lead' ? 'bg-blue-500/10 text-blue-500' :
                contactType === 'client' ? 'bg-green-500/10 text-green-500' :
                'bg-orange-500/10 text-orange-500'
              )}>
                {contactType}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
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
