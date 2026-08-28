import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
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
  /**
   * Send the composed message. Resolves `true` ONLY on a confirmed provider success — the composer
   * is cleared and the thread refreshed on `true` and on nothing else, so a failed send leaves the
   * user's text exactly where they can retry it.
   */
  onSendMessage: (text: string, channel: "sms" | "email", subject?: string) => Promise<boolean>;
  sending?: boolean;
  /**
   * Read-only preview: render the thread, but NO composer.
   *
   * Set while a Super Admin is using "View As". Sending from here would authenticate as the REAL
   * operator — their session token, their connected mailbox, their selected caller ID and their
   * Twilio sender — while addressing a contact that belongs to the viewed agent. The recipient
   * would receive a message from the operator's number that the viewed agent never sent and has no
   * record of. `Conversations.handleSendMessage` refuses the same case independently; this prop is
   * what stops the composer from being offered in the first place.
   */
  readOnly?: boolean;
}

/**
 * A row of the opened thread. `getConversationThread` merges three tables with differing shapes and
 * is typed `any[]` at the API boundary; this local alias keeps that looseness in ONE place instead
 * of scattering `any` (and disable directives) through the component.
 */
type ThreadRow = Record<string, unknown>;

/** Stable empty reference so an unmatched key cannot churn identity on every render. */
const EMPTY_THREAD: ThreadRow[] = [];

/**
 * Realtime coalescing window.
 *
 * A converted contact's SMS carries BOTH `lead_id` and `contact_id`, and the thread subscribes to
 * both (it has to — `getConversationThread` reads both). One inserted row therefore delivers two
 * `postgres_changes` events on the same socket, microseconds apart. This window collapses them
 * into a single reload without adding perceptible latency.
 */
const REALTIME_COALESCE_MS = 50;

/** Per-contact compose state. Stored WITH its contact so it is dropped at render time, not later. */
interface ComposerState {
  key: string;
  text: string;
  subject: string;
  channel: "sms" | "email";
}

const emptyComposer = (key: string): ComposerState => ({ key, text: "", subject: "", channel: "sms" });

/** Per-contact disclosure state, keyed the same way. */
interface ExpandedState {
  key: string;
  recordings: Record<string, boolean>;
  emails: Record<string, boolean>;
}

const EMPTY_EXPANDED: Record<string, boolean> = {};

const ConversationThread: React.FC<ConversationThreadProps> = ({
  contactId,
  contactName,
  contactType,
  onSendMessage,
  readOnly = false,
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
  // EVERY piece of contact-specific UI state is keyed by contact, for the same reason the thread
  // rows are. A draft written for one person must never be one click away from being sent to
  // another — and an `expanded` map keyed by row id would otherwise outlive the contact it belongs
  // to. See `activeComposer` / `activeExpanded` below.
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Only the newest request may commit — see the note on `loaded` above. */
  const loadSeqRef = useRef(0);
  /**
   * The contact this component is CURRENTLY bound to.
   *
   * The sequence guard alone was not enough. It rejected a stale request that finished late, but
   * not a stale contact that STARTED one: a realtime callback bound to contact A, already queued
   * when the user switched to B, would call `loadThread(A)`, bump the shared sequence, and thereby
   * invalidate B's still-in-flight request — leaving B on the spinner with no way to recover.
   * Every entry point now proves its contact is still active BEFORE it starts anything.
   *
   * Written in a LAYOUT effect: it must be current for any callback that runs after a commit, and
   * layout effects run after the commit but before paint and before passive effects — so the
   * load-start effect below already sees the new value.
   */
  const activeContactRef = useRef(contactId);
  /** Coalescing timer for realtime reloads; see REALTIME_COALESCE_MS. */
  const coalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    activeContactRef.current = contactId;
    // Contact-specific UI state is also DISCARDED here, not merely hidden by the render-time match
    // below. Keying alone would resurrect a draft on returning to a contact — but only when the
    // user had not typed anything for the contact in between, since one composer is held at a
    // time. Resetting makes the behaviour the same every time: a new contact, a blank composer.
    setComposer((prev) => (prev && prev.key === contactId ? prev : null));
    setExpanded((prev) => (prev && prev.key === contactId ? prev : null));
  }, [contactId]);

  // Render-time identity match: rows loaded for another contact do not exist for this render.
  const messages = contactId && loaded?.key === contactId ? loaded.rows : EMPTY_THREAD;
  const currentStatus = contactId && status?.key === contactId ? status : null;
  // No status for this contact yet means the request has not settled — that is loading, never an
  // empty thread.
  const loading = contactId ? (currentStatus?.loading ?? true) : false;
  const loadError = currentStatus?.error ?? null;

  const activeComposer = contactId && composer?.key === contactId ? composer : null;
  const messageText = activeComposer?.text ?? "";
  const subjectText = activeComposer?.subject ?? "";
  // Reset per contact rather than carried over: the next contact may have no email address at all,
  // and inheriting the previous one's channel invites a send that cannot succeed.
  const channel = activeComposer?.channel ?? "sms";

  // Belt-and-braces: `loaded` is keyed too, so no frame ever renders another contact's rows through
  // this map and deleting this derivation breaks no test. Kept so the map cannot outlive its contact
  // if `loaded` ever stops being keyed. The layout-effect reset above is the load-bearing half.
  const activeExpanded = contactId && expanded?.key === contactId ? expanded : null;
  const expandedRecordings = activeExpanded?.recordings ?? EMPTY_EXPANDED;
  const expandedEmails = activeExpanded?.emails ?? EMPTY_EXPANDED;

  const patchComposer = useCallback(
    (patch: Partial<Omit<ComposerState, "key">>) => {
      if (!contactId) return;
      setComposer((prev) => ({
        ...(prev && prev.key === contactId ? prev : emptyComposer(contactId)),
        ...patch,
        key: contactId,
      }));
    },
    [contactId],
  );

  const setChannel = useCallback((next: "sms" | "email") => patchComposer({ channel: next }), [patchComposer]);
  const setMessageText = useCallback((next: string) => patchComposer({ text: next }), [patchComposer]);
  const setSubjectText = useCallback((next: string) => patchComposer({ subject: next }), [patchComposer]);

  /**
   * Load ONE contact's thread. The contact is an explicit argument, not a closure over the current
   * prop, so a realtime callback or a post-send refresh can never be re-pointed at whatever contact
   * happens to be open when it fires.
   */
  const loadThread = useCallback(async (targetContactId: string) => {
    if (!targetContactId) return;
    // STALE-START GUARD. A contact that is no longer open may not begin a request, and above all
    // may not touch the shared sequence — doing so silently discarded the ACTIVE contact's
    // in-flight response and stranded it on the loading spinner.
    if (targetContactId !== activeContactRef.current) return;
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

  /**
   * Realtime reload for ONE contact, coalesced and stale-guarded.
   *
   * Checked twice on purpose: once when the event arrives, and again when the timer fires. Effect
   * cleanup is not enough on its own — a callback already queued on the websocket can execute after
   * the subscription has been torn down.
   */
  const scheduleReload = useCallback((targetContactId: string) => {
    // ARRIVAL-TIME guard. Not redundant with the one inside `loadThread`: the coalescing slot is
    // SHARED, so a stale event allowed in here would clear a live event's pending timer and replace
    // it with one that is later rejected — swallowing the live reload entirely.
    if (targetContactId !== activeContactRef.current) return;
    if (coalesceRef.current) clearTimeout(coalesceRef.current);
    coalesceRef.current = setTimeout(() => {
      coalesceRef.current = null;
      // No second check here: `loadThread` re-checks before it starts anything, which is the
      // start-of-request guard. Duplicating it would be code no test could hold to account.
      void loadThread(targetContactId);
    }, REALTIME_COALESCE_MS);
  }, [loadThread]);

  useEffect(() => {
    if (!contactId) return;
    const boundContactId = contactId;
    void loadThread(boundContactId);

    // BOTH SMS link columns are subscribed, because `getConversationThread` reads both
    // (`.or(lead_id.eq.X, contact_id.eq.X)`). A lead's messages carry `lead_id`; a converted
    // client's carry `contact_id`. Filtering on `lead_id` alone meant a converted client's open
    // thread never refreshed on a new message.
    //
    // Two FILTERED registrations, never one unfiltered one: `messages` RLS is organization-wide, so
    // an unfiltered subscription would wake every open thread on every SMS in the organization.
    // A row carrying both columns fires both handlers; `scheduleReload` coalesces that into one
    // reload.
    const channel = supabase
      .channel(`thread-${boundContactId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `lead_id=eq.${boundContactId}`
      }, () => scheduleReload(boundContactId))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `contact_id=eq.${boundContactId}`
      }, () => scheduleReload(boundContactId))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'contact_emails',
        filter: `contact_id=eq.${boundContactId}`
      }, () => scheduleReload(boundContactId))
      .subscribe();

    return () => {
      if (coalesceRef.current) {
        clearTimeout(coalesceRef.current);
        coalesceRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [contactId, loadThread, scheduleReload]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = async () => {
    if (!messageText.trim()) return;
    const boundContactId = contactId;
    const sent = await onSendMessage(messageText, channel, subjectText);
    // NOTHING happens unless the message actually went out. A failed send that cleared the composer
    // destroyed the only copy of the user's text and left them nothing to retry.
    if (!sent) return;
    // The user may also have switched contacts while the send was in flight. Clearing the composer
    // is the part that needs this guard: without it a completed send for A wipes the draft the user
    // has since started for B. The refresh below needs no guard of its own — `loadThread` rejects a
    // stale contact before it starts, so a second check here would be unpinnable duplication.
    if (boundContactId === activeContactRef.current) {
      setMessageText("");
      setSubjectText("");
    }
    void loadThread(boundContactId);
  };

  const patchExpanded = (patch: (prev: ExpandedState) => ExpandedState) => {
    if (!contactId) return;
    setExpanded((prev) =>
      patch(prev && prev.key === contactId ? prev : { key: contactId, recordings: {}, emails: {} }));
  };

  const toggleRecording = (id: string) => {
    patchExpanded((prev) => ({ ...prev, recordings: { ...prev.recordings, [id]: !prev.recordings[id] } }));
  };

  const toggleEmail = (id: string) => {
    patchExpanded((prev) => ({ ...prev, emails: { ...prev.emails, [id]: !prev.emails[id] } }));
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

      {/* Composer Area — replaced by a notice, not merely disabled, when read-only. An unmounted
          composer cannot hold a draft that a later re-render could submit. */}
      <div className="p-6 pt-0 shrink-0 bg-background/80 backdrop-blur-sm z-20">
        {readOnly ? (
          <div
            data-testid="thread-readonly-notice"
            className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground"
          >
            Read-only while viewing as another user. Sending would use your own email connection and
            caller ID, not theirs.
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
};

export default ConversationThread;
