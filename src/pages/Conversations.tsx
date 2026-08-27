import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTwilio } from "@/contexts/TwilioContext";
import { useEffectiveViewer } from "@/hooks/useEffectiveViewer";
import { usersSupabaseApi as usersApi } from "@/lib/supabase-users";
import { emailSupabaseApi } from "@/lib/supabase-email";
import { toE164Plus } from "@/utils/phoneUtils";
import ConversationsSidebar from "@/components/conversations/ConversationsSidebar";
import ConversationThread from "@/components/conversations/ConversationThread";
import ContactBriefView from "@/components/conversations/ContactBriefView";
import { messagesSupabaseApi, ConversationPreview, ScopedContact } from "@/lib/supabase-messages";
import {
  isValidContactId,
  resolveConversationScope,
  type ConversationScope,
} from "@/lib/conversationScope";
import { isOrganizationWideViewer, AGENT_ROLE } from "@/lib/effectiveViewer";

const ConversationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawContactId = searchParams.get("contactId") || undefined;
  // A `?contactId=` is only honoured once it is (a) a real UUID and (b) proven to be inside the
  // effective viewer's scope. `?contactType=` from the URL is deliberately IGNORED — the previous
  // code cast it and defaulted to 'lead', which made an unresolved client render (and be acted on)
  // as a lead, and made ContactBriefView query the wrong table entirely.
  const deepLinkContactId = isValidContactId(rawContactId) ? rawContactId : undefined;

  // The open contact is stored WITH the viewer identity it was resolved for and matched at RENDER
  // time. Clearing it in an effect is one commit too late: on the render where "View As" swaps the
  // effective profile, the previous viewer's thread and contact pane are still mounted and get
  // painted before the effect runs.
  const [selected, setSelected] = useState<{ key: string; contact: ConversationPreview | ScopedContact } | null>(null);
  const [deepLink, setDeepLink] = useState<{ key: string; state: "idle" | "resolving" | "denied" }>({ key: "", state: "idle" });
  const [sending, setSending] = useState(false);
  const { selectedCallerNumber } = useTwilio();

  // ---- Effective viewer + scope ------------------------------------------------------------
  // Identity comes from useAuth().profile via useEffectiveViewer — NEVER useAuth().user, which is
  // always the real Super Admin while "View As" is active.
  const { viewer, key: viewerKey } = useEffectiveViewer();
  const [agentScope, setAgentScope] = useState<{ key: string; ids: string[] } | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [scopeReloadToken, setScopeReloadToken] = useState(0);
  const scopeSeqRef = useRef(0);

  const scopeKey = viewerKey ? `${viewerKey}::${scopeReloadToken}` : null;
  const orgWide = isOrganizationWideViewer(viewer);

  // Render-time identity match — nothing loaded for a previous viewer can survive into this render.
  const selectedContact = viewerKey && selected?.key === viewerKey ? selected.contact : null;
  const deepLinkState = viewerKey && deepLink.key === viewerKey ? deepLink.state : "idle";

  useEffect(() => {
    // Identity changed: invalidate the resolved id set on the SAME render, not one commit later.
    scopeSeqRef.current += 1;
    setAgentScope(null);
    setScopeError(null);
  }, [scopeKey]);

  useEffect(() => {
    if (!viewer || !scopeKey || orgWide) return;
    const seq = (scopeSeqRef.current += 1);

    // The requirement is "Agent: own contacts/conversations", so an Agent is pinned to themselves
    // rather than inheriting getAgentScopeIds' self-plus-descendants contract. For an Agent with
    // no downline the two are identical; this only bites a mis-configured hierarchy.
    if (viewer.role === AGENT_ROLE) {
      setAgentScope({ key: scopeKey, ids: [viewer.viewerId] });
      return;
    }

    usersApi
      .getAgentScopeIds({ viewerId: viewer.viewerId, organizationId: viewer.organizationId })
      .then((ids) => {
        if (scopeSeqRef.current !== seq) return;
        setAgentScope({ key: scopeKey, ids });
      })
      .catch((e) => {
        if (scopeSeqRef.current !== seq) return;
        console.error("[Conversations] agent scope traversal failed:", e);
        // Fail closed: zero rows, surfaced as a recoverable error. NEVER an org-wide fallback.
        setAgentScope({ key: scopeKey, ids: [] });
        setScopeError("Couldn't determine which conversations you can see. Please retry.");
      });
  }, [viewer, scopeKey, orgWide]);

  const resolvedAgentIds = scopeKey && agentScope?.key === scopeKey ? agentScope.ids : null;

  // MEMOIZED deliberately. `resolveConversationScope` builds a fresh object, and `scope` is a
  // dependency of the sidebar's load callback and of its realtime-subscription effect, so an
  // unstable identity re-fetches the whole list and tears down/rebuilds the realtime channel on
  // every page re-render — opening a conversation, resolving a deep link, and so on.
  //
  // To be precise: this is BOUNDED redundant work, not an infinite loop. Sidebar-internal state
  // re-renders the sidebar, not this page, so it cannot feed itself; only page-level state changes
  // rebuild `scope`. Still real churn on every click, hence the memo.
  const scope: ConversationScope | null = React.useMemo(
    () => resolveConversationScope(viewer, orgWide ? null : resolvedAgentIds),
    [viewer, orgWide, resolvedAgentIds],
  );

  const retryScope = useCallback(() => setScopeReloadToken((t) => t + 1), []);

  // ---- Deep link validation ----------------------------------------------------------------
  // A viewer change needs no clearing effect: `selectedContact` and `deepLinkState` above stop
  // matching the new `viewerKey` on the very render the identity changes.
  useEffect(() => {
    if (!deepLinkContactId || !scope || !viewerKey) return;
    // Already resolved for THIS viewer from a sidebar click — nothing to validate.
    if (selectedContact?.contact_id === deepLinkContactId) return;

    let cancelled = false;
    const keyAtStart = viewerKey;
    setDeepLink({ key: keyAtStart, state: "resolving" });
    messagesSupabaseApi
      .resolveScopedContact(deepLinkContactId, scope)
      .then((hit) => {
        if (cancelled) return;
        if (!hit) {
          // Out of scope, or gone. Show nothing rather than guessing a type.
          setSelected(null);
          setDeepLink({ key: keyAtStart, state: "denied" });
          return;
        }
        setSelected({ key: keyAtStart, contact: hit });
        setDeepLink({ key: keyAtStart, state: "idle" });
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[Conversations] deep-link resolution failed:", e);
        setSelected(null);
        setDeepLink({ key: keyAtStart, state: "denied" });
      });
    return () => { cancelled = true; };
  }, [deepLinkContactId, scope, viewerKey, selectedContact?.contact_id]);

  const handleSelectContact = (convo: ConversationPreview) => {
    if (!viewerKey) return;
    setSelected({ key: viewerKey, contact: convo });
    setDeepLink({ key: viewerKey, state: "idle" });
    setSearchParams({
      contactId: convo.contact_id,
      contactType: convo.contact_type,
    });
  };

  const handleSendMessage = async (text: string, channel: "sms" | "email", subject?: string) => {
    if (!selectedContact) return;
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Session expired. Please log in again.");
        return;
      }

      if (channel === "email") {
        const contactEmail = selectedContact.contact_email;
        if (!contactEmail) {
          toast.error("This contact has no email address.");
          return;
        }

        // Fetch first connected email if not already present
        const connections = await emailSupabaseApi.getMyConnections();
        const connection = connections.find(c => c.status === 'connected');
        
        if (!connection) {
          toast.error("No connected email found. Go to Settings > Email Setup.");
          return;
        }

        const res = await emailSupabaseApi.sendContactEmail({
          contact_id: selectedContact.contact_id,
          to_email: contactEmail,
          subject: subject || `Message from AgentFlow`,
          body_text: text,
          connection_id: connection.id,
          from_email: connection.provider_account_email,
          contact_type: selectedContact.contact_type
        });

        if (!res.success) throw new Error(res.error || "Failed to send email");
        toast.success("Email sent");
      } else {
        const contactPhone = selectedContact.contact_phone;
        if (!contactPhone) {
          toast.error("This contact has no phone number.");
          return;
        }

        if (!selectedCallerNumber) {
          toast.error("No caller ID selected. Use the dialer to select a number.");
          return;
        }

        const base = import.meta.env.VITE_SUPABASE_URL as string;
        const res = await fetch(`${base}/functions/v1/twilio-sms`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json", 
            Authorization: `Bearer ${session.access_token}` 
          },
          body: JSON.stringify({
            to: toE164Plus(contactPhone),
            from: toE164Plus(selectedCallerNumber),
            body: text,
            contact_id: selectedContact.contact_id,
            contact_type: selectedContact.contact_type,
            lead_id: selectedContact.contact_id,
          }),
        });

        const result = await res.json();
        if (!result.success) throw new Error(result.error || "Failed to send SMS");
        toast.success("Message sent");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <ConversationsSidebar
        selectedContactId={selectedContact?.contact_id}
        onSelectContact={handleSelectContact}
        scope={scope}
        scopeKey={scopeKey}
        scopeError={scopeError}
        onRetryScope={retryScope}
      />

      {deepLinkState === "denied" ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-accent/5">
          <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-muted-foreground/40 mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Conversation not available</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            This contact isn't in your conversations, or it no longer exists.
          </p>
        </div>
      ) : selectedContact ? (
        <>
          <ConversationThread
            contactId={selectedContact.contact_id}
            contactName={selectedContact.contact_name}
            // The RESOLVED type, from the table the contact was actually found in — never the URL.
            contactType={selectedContact.contact_type}
            onSendMessage={handleSendMessage}
            sending={sending}
          />
          <ContactBriefView
            contactId={selectedContact.contact_id}
            contactType={selectedContact.contact_type}
          />
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 bg-accent/5">
          <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center text-primary/30 mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Your Unified Inbox</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Select a conversation from the list to start messaging with your leads across SMS and Email.
          </p>
        </div>
      )}
    </div>
  );
};

export default ConversationsPage;
