import React, { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, X, Plus, Send, ArrowLeft, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { motion, AnimatePresence } from "framer-motion";

interface ChatGroup {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

interface ChatMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  senderName?: string;
}

interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  email: string;
}

type View = "groups" | "chat" | "newGroup";

export default function FloatingChat() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  /** Leaderboard TV fullscreen sets `document.body.dataset.tvMode = "true"` — hide chat bubble so it does not cover the display. */
  const [tvModeActive, setTvModeActive] = useState(() =>
    typeof document !== "undefined" && document.body?.dataset?.tvMode === "true"
  );
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("groups");
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState<ChatGroup | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [profilesMap, setProfilesMap] = useState<Record<string, UserProfile>>({});

  // Dragging state
  const [position, setPosition] = useState({ x: 0, y: 0 }); // offset from default bottom-right
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch groups
  const fetchGroups = useCallback(async () => {
    if (!user) return;
    setLoadingGroups(true);
    try {
      const { data: memberRows } = await supabase
        .from("chat_group_members")
        .select("group_id")
        .eq("user_id", user.id);

      if (!memberRows?.length) { setGroups([]); setLoadingGroups(false); return; }

      const groupIds = memberRows.map((r: any) => r.group_id);
      const { data: groupRows } = await supabase
        .from("chat_groups")
        .select("*")
        .in("id", groupIds)
        .order("updated_at", { ascending: false });

      setGroups(groupRows ?? []);
    } catch (e) {
      console.error("Failed to fetch groups", e);
    }
    setLoadingGroups(false);
  }, [user]);

  // Fetch profiles for display
  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, first_name, last_name, avatar_url, email");
    if (data) {
      const map: Record<string, UserProfile> = {};
      data.forEach((p: any) => { map[p.id] = p; });
      setProfilesMap(map);
      setAllUsers(data as UserProfile[]);
    }
  }, []);

  useEffect(() => {
    const el = document.body;
    const sync = () => setTvModeActive(el.dataset.tvMode === "true");
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-tv-mode"] });
    sync();
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    if (tvModeActive) setOpen(false);
  }, [tvModeActive]);

  useEffect(() => {
    if (open && user) {
      fetchGroups();
      fetchProfiles();
    }
  }, [open, user, fetchGroups, fetchProfiles]);

  // Fetch messages for active group
  const fetchMessages = useCallback(async (groupId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .limit(200);

    const msgs = (data ?? []).map((m: any) => ({
      ...m,
      senderName: profilesMap[m.sender_id]
        ? `${profilesMap[m.sender_id].first_name} ${profilesMap[m.sender_id].last_name}`
        : "Unknown",
    }));
    setMessages(msgs);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [profilesMap]);

  useEffect(() => {
    if (activeGroup) fetchMessages(activeGroup.id);
  }, [activeGroup, fetchMessages]);

  // Real-time subscription for messages
  useEffect(() => {
    if (!activeGroup) return;
    const channel = supabase
      .channel(`chat-${activeGroup.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `group_id=eq.${activeGroup.id}` },
        (payload: any) => {
          const msg = payload.new;
          setMessages((prev) => [
            ...prev,
            {
              ...msg,
              senderName: profilesMap[msg.sender_id]
                ? `${profilesMap[msg.sender_id].first_name} ${profilesMap[msg.sender_id].last_name}`
                : "Unknown",
            },
          ]);
          setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeGroup, profilesMap]);

  // Send message
  const sendMessage = async () => {
    if (!messageText.trim() || !activeGroup || !user) return;
    const content = messageText.trim();
    setMessageText("");
    await supabase.from("chat_messages").insert({
      group_id: activeGroup.id,
      sender_id: user.id,
      content,
    });
    // Update group timestamp
    await supabase.from("chat_groups").update({ updated_at: new Date().toISOString() }).eq("id", activeGroup.id);
  };

  // Create group
  const createGroup = async () => {
    if (!newGroupName.trim() || selectedUsers.length === 0 || !user) return;
    const { data: group, error } = await supabase
      .from("chat_groups")
      .insert({ name: newGroupName.trim(), created_by: user.id, organization_id: organizationId } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .select()
      .single();
    if (error || !group) return;

    // Add members (creator + selected)
    const members = [user.id, ...selectedUsers].map((uid) => ({
      group_id: group.id,
      user_id: uid,
    }));
    await supabase.from("chat_group_members").insert(members);

    setNewGroupName("");
    setSelectedUsers([]);
    setView("groups");
    fetchGroups();
  };

  // Dragging handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(false);
    dragStartRef.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setIsDragging(true);
    setPosition({
      x: dragStartRef.current.posX + dx,
      y: dragStartRef.current.posY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const wasDragging = isDragging;
    dragStartRef.current = null;
    if (!wasDragging) {
      setOpen((prev) => !prev);
    }
    // Reset isDragging after a tick so the click handler doesn't fire
    setTimeout(() => setIsDragging(false), 0);
  };

  const openChat = (group: ChatGroup) => {
    setActiveGroup(group);
    setView("chat");
  };

  const filteredUsers = allUsers.filter(
    (u) =>
      u.id !== user?.id &&
      (`${u.first_name} ${u.last_name}`.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()))
  );

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  if (tvModeActive) return null;

  return (
    <>
      {/* Chat Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ duration: 0.2 }}
            className="fixed z-[9999] w-80 h-[28rem] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{
              right: `calc(1.5rem - ${position.x}px)`,
              bottom: `calc(5.5rem - ${position.y}px)`,
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary/5">
              {view !== "groups" && (
                <button
                  onClick={() => { setView("groups"); setActiveGroup(null); }}
                  className="p-1 rounded hover:bg-muted transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 text-foreground" />
                </button>
              )}
              <h3 className="text-sm font-semibold text-foreground flex-1 truncate">
                {view === "groups" && "Team Chat"}
                {view === "chat" && activeGroup?.name}
                {view === "newGroup" && "New Group"}
              </h3>
              {view === "groups" && (
                <button
                  onClick={() => setView("newGroup")}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  title="New group"
                >
                  <Plus className="w-4 h-4 text-primary" />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {/* Groups list */}
              {view === "groups" && (
                <div className="divide-y divide-border">
                  {loadingGroups ? (
                    <p className="text-xs text-muted-foreground p-4 text-center">Loading…</p>
                  ) : groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
                      <Users className="w-10 h-10 text-muted-foreground/40 mb-3" />
                      <p className="text-sm text-muted-foreground">No chats yet</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Tap + to start a group</p>
                    </div>
                  ) : (
                    groups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => openChat(g)}
                        className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Users className="w-4 h-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {g.updated_at ? formatTime(g.updated_at) : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Chat view */}
              {view === "chat" && (
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ maxHeight: "calc(28rem - 7.5rem)" }}>
                    {messages.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8">No messages yet. Say hello!</p>
                    )}
                    {messages.map((m) => {
                      const isMe = m.sender_id === user?.id;
                      return (
                        <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                          {!isMe && (
                            <span className="text-[10px] text-muted-foreground ml-1 mb-0.5">{m.senderName}</span>
                          )}
                          <div
                            className={cn(
                              "max-w-[75%] px-3 py-1.5 rounded-2xl text-sm break-words",
                              isMe
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted text-foreground rounded-bl-md"
                            )}
                          >
                            {m.content}
                          </div>
                          <span className="text-[10px] text-muted-foreground mt-0.5 mx-1">
                            {formatTime(m.created_at)}
                          </span>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              )}

              {/* New Group view */}
              {view === "newGroup" && (
                <div className="p-4 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Group Name</label>
                    <input
                      className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="e.g. Sales Team"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Add Members</label>
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Search users…"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                    </div>
                    {selectedUsers.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {selectedUsers.map((uid) => {
                          const u = profilesMap[uid];
                          return (
                            <span key={uid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                              {u ? `${u.first_name} ${u.last_name}` : uid.slice(0, 8)}
                              <button onClick={() => setSelectedUsers((p) => p.filter((id) => id !== uid))}>
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="max-h-36 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                      {filteredUsers.map((u) => {
                        const selected = selectedUsers.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            onClick={() =>
                              setSelectedUsers((prev) =>
                                selected ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                              )
                            }
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                              selected ? "bg-primary/5" : "hover:bg-muted/50"
                            )}
                          >
                            <div className={cn(
                              "w-4 h-4 rounded border flex items-center justify-center shrink-0",
                              selected ? "bg-primary border-primary" : "border-border"
                            )}>
                              {selected && <span className="text-primary-foreground text-[10px]">✓</span>}
                            </div>
                            <span className="text-foreground">{u.first_name} {u.last_name}</span>
                            <span className="text-muted-foreground text-xs ml-auto truncate">{u.email}</span>
                          </button>
                        );
                      })}
                      {filteredUsers.length === 0 && (
                        <p className="text-xs text-muted-foreground p-3 text-center">No users found</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={createGroup}
                    disabled={!newGroupName.trim() || selectedUsers.length === 0}
                    className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Create Group
                  </button>
                </div>
              )}
            </div>

            {/* Message input (chat view only) */}
            {view === "chat" && (
              <div className="border-t border-border px-3 py-2 flex items-center gap-2">
                <input
                  className="flex-1 px-3 py-1.5 text-sm rounded-full border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Type a message…"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                />
                <button
                  onClick={sendMessage}
                  disabled={!messageText.trim()}
                  className="p-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Bubble */}
      <div
        ref={bubbleRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          "fixed z-[10000] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-none",
          "hover:shadow-xl hover:scale-105 transition-shadow transition-transform"
        )}
        style={{
          right: `calc(1.5rem - ${position.x}px)`,
          bottom: `calc(1.5rem - ${position.y}px)`,
        }}
        title="Team Chat"
      >
        {open ? (
          <X className="w-6 h-6 pointer-events-none" />
        ) : (
          <MessageCircle className="w-6 h-6 pointer-events-none" />
        )}
      </div>
    </>
  );
}
