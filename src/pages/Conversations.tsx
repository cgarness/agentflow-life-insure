import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTwilio } from "@/contexts/TwilioContext";
import { emailSupabaseApi } from "@/lib/supabase-email";
import { toE164Plus } from "@/utils/phoneUtils";
import ConversationsSidebar from "@/components/conversations/ConversationsSidebar";
import ConversationThread from "@/components/conversations/ConversationThread";
import ContactBriefView from "@/components/conversations/ContactBriefView";
import { ConversationPreview } from "@/lib/supabase-messages";

const ConversationsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedContactId = searchParams.get("contactId") || undefined;
  const selectedContactType = searchParams.get("contactType") as 'lead' | 'client' | 'recruit' || 'lead';
  
  const [selectedContact, setSelectedContact] = useState<ConversationPreview | null>(null);
  const [sending, setSending] = useState(false);
  const { selectedCallerNumber } = useTwilio();
  const { user } = useAuth();

  const handleSelectContact = (convo: ConversationPreview) => {
    setSelectedContact(convo);
    setSearchParams({ 
      contactId: convo.contact_id, 
      contactType: convo.contact_type 
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
          from_email: connection.provider_account_email
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
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background">
      <ConversationsSidebar 
        selectedContactId={selectedContactId}
        onSelectContact={handleSelectContact}
      />
      
      {selectedContactId ? (
        <>
          <ConversationThread 
            contactId={selectedContactId}
            contactName={selectedContact?.contact_name || "Unknown"}
            contactType={selectedContactType}
            onSendMessage={handleSendMessage}
            sending={sending}
          />
          <ContactBriefView 
            contactId={selectedContactId}
            contactType={selectedContactType}
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
