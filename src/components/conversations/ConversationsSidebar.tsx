import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, MessageSquare, Mail, User, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { messagesSupabaseApi, ConversationPreview } from "@/lib/supabase-messages";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import type { ConversationScope } from "@/lib/conversationScope";

interface ConversationsSidebarProps {
  selectedContactId?: string;
  onSelectContact: (contact: ConversationPreview) => void;
  /**
   * The resolved scope for the EFFECTIVE viewer. `null` means unresolved — the sidebar shows the
   * loading skeleton and issues NO query. It never falls back to an unscoped read.
   */
  scope: ConversationScope | null;
  /** Identity key; a change clears the list and invalidates any in-flight response. */
  scopeKey: string | null;
  /** True when scope resolution itself failed — surfaced as a recoverable error, not an empty list. */
  scopeError?: string | null;
  onRetryScope?: () => void;
}

const ConversationsSidebar: React.FC<ConversationsSidebarProps> = ({
  selectedContactId,
  onSelectContact,
  scope,
  scopeKey,
  scopeError = null,
  onRetryScope,
}) => {
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Only the newest load may commit. The realtime handler below fires on every org message with
  // no debounce, so concurrent loads are routine and out-of-order resolution is not hypothetical.
  const loadSeqRef = useRef(0);

  // Identity changed: the rows on screen belong to the previous viewer — drop them with it.
  useEffect(() => {
    loadSeqRef.current += 1;
    setConversations([]);
    setError(null);
    setLoading(true);
  }, [scopeKey]);

  const loadConversations = useCallback(async () => {
    if (!scope) return;
    const seq = (loadSeqRef.current += 1);
    setLoading(true);
    setError(null);
    try {
      const data = await messagesSupabaseApi.getRecentConversations(scope);
      if (loadSeqRef.current !== seq) return; // superseded — a newer viewer owns the screen
      setConversations(data);
      setLoading(false);
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      console.error("Error loading conversations:", err);
      // Fail closed AND say so: a partial list that renders like a complete one is the trap the
      // previous implementation fell into (it swallowed every query error).
      setConversations([]);
      setError(err instanceof Error ? err.message : "Could not load conversations.");
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    if (!scope) {
      // Unresolved scope: no query, and no premature empty state.
      setLoading(!scopeError);
      return;
    }

    void loadConversations();

    // SMS and email ONLY. `calls` is deliberately absent: a call must never trigger a sidebar
    // refresh, just as it must never create or rank a conversation.
    const channel = supabase
      .channel(`sidebar-realtime-${scopeKey ?? "none"}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => void loadConversations())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_emails' }, () => void loadConversations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [scope, scopeKey, scopeError, loadConversations]);

  const filteredConversations = conversations.filter((c) =>
    c.contact_name.toLowerCase().includes(search.toLowerCase()) ||
    c.last_message?.toLowerCase().includes(search.toLowerCase())
  );

  // Only SMS and email can reach the sidebar (`ConversationPreview['channel']` is narrowed to those
  // two), so there is no call icon to render here any more.
  const getIcon = (channel: string) => {
    switch (channel) {
      case "sms": return <MessageSquare className="w-3.5 h-3.5 text-blue-500" />;
      case "email": return <Mail className="w-3.5 h-3.5 text-violet-500" />;
      default: return <User className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const displayError = scopeError ?? error;

  return (
    <div className="w-[320px] border-r border-border flex flex-col bg-card/50">
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search conversations..."
            className="w-full bg-background border border-border rounded-lg py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="w-10 h-10 bg-muted rounded-full" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-2 bg-muted rounded w-3/4" />
                  <div className="h-2 bg-muted rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : displayError ? (
          // Distinct from the empty state on purpose: a failed load must never read as
          // "you have no conversations".
          <div className="p-8 text-center">
            <AlertTriangle className="w-8 h-8 text-destructive/60 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">Couldn't load conversations</p>
            <p className="text-xs text-muted-foreground mb-4">{displayError}</p>
            <button
              onClick={() => (scopeError && onRetryScope ? onRetryScope() : void loadConversations())}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p className="text-sm">No conversations found.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredConversations.map((convo) => (
              <button
                key={convo.contact_id}
                onClick={() => onSelectContact(convo)}
                className={cn(
                  "w-full text-left p-4 flex gap-3 hover:bg-accent/50 transition-colors group relative",
                  selectedContactId === convo.contact_id && "bg-accent border-r-2 border-primary"
                )}
              >
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm uppercase">
                    {convo.contact_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 bg-background p-0.5 rounded-full ring-1 ring-border shadow-sm">
                    {getIcon(convo.channel)}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {convo.contact_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(convo.last_message_at), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate line-clamp-1">
                    {convo.direction === 'outbound' && <span className="font-medium mr-1">You:</span>}
                    {convo.last_message}
                  </p>
                  
                  {/* Badge for contact type */}
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider",
                      convo.contact_type === 'lead' ? 'bg-blue-500/10 text-blue-500' :
                      convo.contact_type === 'client' ? 'bg-green-500/10 text-green-500' :
                      'bg-orange-500/10 text-orange-500'
                    )}>
                      {convo.contact_type}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationsSidebar;
