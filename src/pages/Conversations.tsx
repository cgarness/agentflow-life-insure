import React, { useState, useEffect, useRef } from "react";
import { Phone, MessageSquare, Mail, Search, Play, Loader2, MessageCircle, Plus, ArrowLeft, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";

interface ConversationSummary {
  phone: string;
  contactName: string;
  leadId: string | null;
  preview: string;
  time: string;
  sentAt: string;
}

interface Message {
  id: string;
  body: string;
  direction: string;
  sent_at: string;
  from_number: string;
  to_number: string;
}

const channelIcons: Record<string, React.ReactNode> = {
  call: <Phone className="w-3 h-3" />,
  sms: <MessageSquare className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
};

const Conversations: React.FC = () => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState("All");
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // New Message modal state
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [newMsgStep, setNewMsgStep] = useState<1 | 2>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; first_name: string; last_name: string; phone: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [newMsgText, setNewMsgText] = useState("");
  const [newMsgSending, setNewMsgSending] = useState(false);

  // Load conversations grouped by phone number
  const loadConversations = async () => {
    setLoadingConvos(true);
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .order("sent_at", { ascending: false });

    if (error) {
      console.error("Error loading messages:", error);
      setLoadingConvos(false);
      return;
    }

    if (!messages || messages.length === 0) {
      setConversations([]);
      setLoadingConvos(false);
      return;
    }

    // Group by to_number, pick most recent message per number
    const grouped = new Map<string, typeof messages[0]>();
    for (const msg of messages) {
      const key = msg.direction === "outbound" ? msg.to_number : msg.from_number;
      if (!grouped.has(key)) {
        grouped.set(key, msg);
      }
    }

    // Look up lead names
    const phones = Array.from(grouped.keys());
    const { data: leads } = await supabase
      .from("leads")
      .select("id, first_name, last_name, phone")
      .in("phone", phones);

    const leadMap = new Map<string, { name: string; id: string }>();
    if (leads) {
      for (const l of leads) {
        leadMap.set(l.phone, { name: `${l.first_name} ${l.last_name}`.trim(), id: l.id });
      }
    }

    const convos: ConversationSummary[] = Array.from(grouped.entries()).map(([phone, msg]) => {
      const lead = leadMap.get(phone);
      return {
        phone,
        contactName: lead?.name || phone,
        leadId: lead?.id || msg.lead_id || null,
        preview: msg.body,
        time: msg.sent_at ? formatDistanceToNow(new Date(msg.sent_at), { addSuffix: true }) : "",
        sentAt: msg.sent_at || "",
      };
    });

    convos.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    setConversations(convos);
    setLoadingConvos(false);
  };

  useEffect(() => {
    loadConversations();
  }, []);

  // Search contacts for New Message modal
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearchLoading(true);
      const q = `%${searchQuery}%`;
      const { data } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone")
        .or(`first_name.ilike.${q},last_name.ilike.${q},phone.ilike.${q}`)
        .limit(20);
      setSearchResults(data || []);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const handleNewMsgSend = async () => {
    if (!newMsgText.trim() || !selectedContact) return;
    setNewMsgSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("You must be logged in to send messages", { duration: 5000 });
        setNewMsgSending(false);
        return;
      }
      const res = await fetch(
        `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/telnyx-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            to: selectedContact.phone,
            body: newMsgText.trim(),
            lead_id: selectedContact.id,
          }),
        }
      );
      const result = await res.json();
      if (!result.success) {
        toast.error(result.error || "Failed to send message", { duration: 5000 });
        setNewMsgSending(false);
        return;
      }
      setShowNewMessage(false);
      setNewMsgStep(1);
      setSearchQuery("");
      setSearchResults([]);
      setSelectedContact(null);
      setNewMsgText("");
      toast.success("Message sent", { duration: 3000 });
      loadConversations();
    } catch (err: any) {
      toast.error(err.message || "Failed to send message", { duration: 5000 });
    } finally {
      setNewMsgSending(false);
    }
  };

  // Load thread when active conversation changes
  useEffect(() => {
    if (activeIndex === null || !conversations[activeIndex]) {
      setThreadMessages([]);
      return;
    }
    const phone = conversations[activeIndex].phone;
    async function loadThread() {
      setLoadingThread(true);
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`to_number.eq.${phone},from_number.eq.${phone}`)
        .order("sent_at", { ascending: true });

      if (error) {
        console.error("Error loading thread:", error);
      }
      setThreadMessages((data as Message[]) || []);
      setLoadingThread(false);
    }
    loadThread();
  }, [activeIndex, conversations]);

  // Scroll to bottom on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages]);

  const handleSend = async () => {
    if (!messageText.trim() || activeIndex === null) return;
    const convo = conversations[activeIndex];
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("You must be logged in to send messages", { duration: 5000 });
        setSending(false);
        return;
      }

      const res = await fetch(
        `https://jncvvsvckxhqgqvkppmj.supabase.co/functions/v1/telnyx-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            to: convo.phone,
            body: messageText.trim(),
            lead_id: convo.leadId,
          }),
        }
      );

      const result = await res.json();

      if (!result.success) {
        toast.error(result.error || "Failed to send message", { duration: 5000 });
        setSending(false);
        return;
      }

      // Optimistic update
      const newMsg: Message = {
        id: result.message_id || crypto.randomUUID(),
        body: messageText.trim(),
        direction: "outbound",
        sent_at: new Date().toISOString(),
        from_number: "",
        to_number: convo.phone,
      };
      setThreadMessages((prev) => [...prev, newMsg]);
      setMessageText("");
      toast.success("Message sent", { duration: 3000 });
    } catch (err: any) {
      toast.error(err.message || "Failed to send message", { duration: 5000 });
    } finally {
      setSending(false);
    }
  };

  const selectedConvo = activeIndex !== null ? conversations[activeIndex] : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Conversations</h1>
        <button
          onClick={() => { setShowNewMessage(true); setNewMsgStep(1); setSearchQuery(""); setSearchResults([]); setSelectedContact(null); setNewMsgText(""); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all duration-150"
        >
          <MessageSquare className="w-4 h-4" />
          <Plus className="w-4 h-4" />
          New Message
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 bg-card rounded-xl border overflow-hidden" style={{ height: "calc(100vh - 180px)" }}>
        {/* Left Panel */}
        <div className="lg:col-span-2 border-r flex flex-col">
          <div className="p-3 border-b space-y-3 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search conversations..." className="w-full h-9 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="flex gap-1">
              {["All", "Calls", "SMS", "Email"].map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium sidebar-transition ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{f}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingConvos ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                <MessageCircle className="w-12 h-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">No conversations yet. Send your first message from a contact's profile.</p>
              </div>
            ) : (
              conversations.map((c, i) => (
                <button
                  key={c.phone}
                  onClick={() => setActiveIndex(i)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b sidebar-transition ${activeIndex === i ? "bg-primary/5" : "hover:bg-accent/50"}`}
                >
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {c.contactName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center text-muted-foreground">{channelIcons.sms}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-foreground truncate">{c.contactName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{c.time}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{c.preview}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="lg:col-span-3 flex flex-col">
          {selectedConvo ? (
            <>
              {/* Contact Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                    {selectedConvo.contactName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{selectedConvo.contactName}</p>
                    <p className="text-xs text-muted-foreground">{selectedConvo.phone}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 sidebar-transition"><Phone className="w-4 h-4" /></button>
                  <button className="w-8 h-8 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><MessageSquare className="w-4 h-4" /></button>
                  <button className="w-8 h-8 rounded-lg bg-accent text-foreground flex items-center justify-center hover:bg-accent/80 sidebar-transition"><Mail className="w-4 h-4" /></button>
                </div>
              </div>

              {/* Thread */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loadingThread ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : threadMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-sm text-muted-foreground">No messages in this conversation yet.</p>
                  </div>
                ) : (
                  threadMessages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`rounded-xl px-4 py-3 max-w-[80%] ${m.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"}`}>
                        <p className="text-sm">{m.body}</p>
                        <p className={`text-xs mt-1 ${m.direction === "outbound" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {m.sent_at ? format(new Date(m.sent_at), "MMM d, h:mm a") : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Compose */}
              <div className="border-t p-3 shrink-0">
                <div className="flex gap-1 mb-2">
                  {["SMS", "Email"].map((t) => (
                    <button key={t} className={`px-3 py-1 rounded-md text-xs font-medium sidebar-transition ${t === "SMS" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>{t}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !sending && handleSend()}
                    className="flex-1 px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !messageText.trim()}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 sidebar-transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {sending && <Loader2 className="w-3 h-3 animate-spin" />}
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Select a conversation to view messages</p>
            </div>
          )}
        </div>
      </div>
      {/* New Message Modal */}
      {showNewMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowNewMessage(false)} />
          <div className="relative bg-card border rounded-xl shadow-2xl w-full max-w-md flex flex-col" style={{ maxHeight: "80vh" }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <h2 className="text-lg font-semibold text-foreground">New Message</h2>
              <button onClick={() => setShowNewMessage(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {newMsgStep === 1 ? (
              /* Step 1: Contact Search */
              <div className="flex flex-col flex-1 min-h-0">
                <div className="p-4 border-b shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search contacts by name or phone..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      autoFocus
                      className="w-full h-10 pl-9 pr-4 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : searchQuery.length < 2 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Type at least 2 characters to search</p>
                  ) : searchResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No contacts found</p>
                  ) : (
                    searchResults.map(r => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setSelectedContact({ id: r.id, name: `${r.first_name} ${r.last_name}`.trim(), phone: r.phone });
                          setNewMsgStep(2);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 border-b transition-all duration-150"
                      >
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                          {r.first_name?.[0]?.toUpperCase()}{r.last_name?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{r.first_name} {r.last_name}</p>
                          <p className="text-xs text-muted-foreground">{r.phone}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              /* Step 2: Compose */
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
                  <button onClick={() => setNewMsgStep(1)} className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {selectedContact?.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{selectedContact?.name}</p>
                    <p className="text-xs text-muted-foreground">{selectedContact?.phone}</p>
                  </div>
                </div>
                <div className="flex-1 p-4">
                  <textarea
                    value={newMsgText}
                    onChange={e => setNewMsgText(e.target.value)}
                    placeholder="Type your message..."
                    rows={5}
                    className="w-full px-3 py-2 rounded-lg bg-accent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    autoFocus
                  />
                </div>
                <div className="px-4 pb-4 shrink-0">
                  <button
                    onClick={handleNewMsgSend}
                    disabled={newMsgSending || !newMsgText.trim()}
                    className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {newMsgSending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {newMsgSending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Conversations;
