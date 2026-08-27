import React, { useState, useEffect, useRef, useCallback } from "react";
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

/**
 * A row of the opened thread. `getConversationThread` merges three tables with differing shapes and
 * is typed `any[]` at the API boundary; this local alias keeps that looseness in ONE place instead
 * of scattering `any` (and disable directives) through the component.
 */
type ThreadRow = Record<string, unknown>;

/** Stable empty reference so an unmatched key cannot churn identity on every render. */
const EMPTY_THREAD: ThreadRow[] = [];

const ConversationThread: React.FC<ConversationThreadProps> = ({
  contactId,
  contactName,
  contactType,
  onSendMessage,
  sending = false,
}) => {
  // Thread data and status are stored WITH the contact identity they were loaded for, and matched
  // at RENDER time. Two defects this closes:
  //   1. the load for a new contact only STARTS in a passive effect, which runs after the commit —
  //      so an unkeyed `messages` renders contact A's rows under contact B for a frame;
  //   2. a request issued for A that resolves AFTER B's would overwrite B's messages, loading flag
  //      and error state, because nothing tied a response to the request that asked for it.
  const [loaded, setLoaded] = useState<{ key: string; rows: ThreadRow[] } | null>(null);
  const [status, setStatus] = useState<{ key: string; loading: boolean; error: string | null } | null>(null);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [messageText, setMessageText] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [expandedRecordings, setExpandedRecordings] = useState<Record<string, boolean>>({});
  const [expandedEmails, setExpandedEmails] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Only the newest request may commit — see the note on `loaded` above. */
  const loadSeqRef = useRef(0);

  // Render-time identity match: rows loaded for another contact do not exist for this render.
  const messages = contactId && loaded?.key === contactId ? loaded.rows : EMPTY_THREAD;
  const currentStatus = contactId && status?.key === contactId ? status : null;
  // No status for this contact yet means the request has not settled — that is loading, never an
  // empty thread.
  const loading = contactId ? (currentStatus?.loading ?? true) : false;
  const loadError = currentStatus?.error ?? null;

  /**
   * Load ONE contact's thread. The contact is an explicit argument, not a closure over the current
   * prop, so a realtime callback or a post-send refresh can never be re-pointed at whatever contact
   * happens to be open when it fires.
   */
  const loadThread = useCallback(async (targetContactId: string) => {
    if (!targetContactId) return;
    const seq = (loadSeqRef.current += 1);
    setStatus({ key: targetContactId, loading: true, error: null });
    try {
      const data = await messagesSupabaseApi.getConversationThread(targetContactId);
      if (loadSeqRef.current !== seq) return; // superseded — another contact owns the screen
      setLoaded({ key: targetContactId, rows: data });
      setStatus({ key: targetContactId, loading: false, error: null });
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      console.error("Error loading thread:", err);
      setLoaded({ key: targetContactId, rows: EMPTY_THREAD });
      setStatus({
        key: targetContactId,
        loading: false,
        error: err instanceof Error ? err.message : "Could not load this conversation.",
      });
    }
  }, []);

  useEffect(() => {
    if (!contactId) return;
    const boundContactId = contactId;
    void loadThread(boundContactId);

    const channel = supabase
      .channel(`thread-${boundContactId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `lead_id=eq.${boundContactId}`
      }, () => void loadThread(boundContactId))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'contact_emails',
        filter: `contact_id=eq.${boundContactId}`
      }, () => void loadThread(boundContactId))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId, loadThread]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = async () => {
    if (!messageText.trim()) return;
    const boundContactId = contactId;
    await onSendMessage(messageText, channel, subjectText);
    setMessageText("");
    setSubjectText("");
    // Bound to the contact that was open when the send started.
    void loadThread(boundContactId);
  };

  const toggleRecording = (id: string) => {
    setExpandedRecordings(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEmail = (id: string) => {
    setExpandedEmails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderIcon = (type: string, isOutbound: boolean) => {
    const iconCls = "w-3.5 h-3.5 transition-all duration-200 hover:scale-125 hover:opacity-100 cursor-default";
    switch (type) {
      case "call": return <Phone className={cn(iconCls, "text-emerald-500 opacity-70")} />;
      case "sms": return <MessageSquare className={cn(iconCls, "text-blue-500 opacity-70")} />;
      case "email": return <Mail className={cn(iconCls, "text-violet-500 opacity-70")} />;
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
    <div className="flex-1 flex flex-col bg-background relative overflow-hidden min-h-0 h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col min-h-0">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin opacity-20" />
          </div>
        ) : loadError ? (
          /* A failed load must never read as an empty conversation. */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <p className="text-sm font-medium text-foreground mb-1">Couldn't load this conversation</p>
            <p className="text-xs text-muted-foreground mb-4">{loadError}</p>
            <button
              onClick={() => void loadThread(contactId)}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
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
      <div className="p-6 pt-0 shrink-0 bg-background/80 backdrop-blur-sm z-20">
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
