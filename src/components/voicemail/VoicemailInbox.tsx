import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTelnyx } from "@/contexts/TelnyxContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Voicemail as VoicemailIcon, Inbox } from "lucide-react";
import { toast } from "sonner";
import VoicemailRow, { VoicemailRecord } from "./VoicemailRow";

type Tab = "personal" | "org";

const VoicemailInbox: React.FC = () => {
  const { profile } = useAuth();
  const { makeCall } = useTelnyx();
  const [loading, setLoading] = useState(true);
  const [voicemails, setVoicemails] = useState<VoicemailRecord[]>([]);
  const [tab, setTab] = useState<Tab>("personal");

  const fetchVoicemails = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);

    const { data, error } = await (supabase as any)
      .from("voicemails")
      .select(`
        id,
        organization_id,
        agent_id,
        contact_id,
        caller_number,
        recording_url,
        duration_seconds,
        transcription,
        is_read,
        created_at,
        contact:leads!voicemails_contact_id_fkey(id, first_name, last_name)
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      toast.error("Failed to load voicemails");
      setLoading(false);
      return;
    }

    setVoicemails((data || []) as VoicemailRecord[]);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    fetchVoicemails();
  }, [fetchVoicemails]);

  const handleMarkRead = useCallback(async (id: string) => {
    setVoicemails((prev) => prev.map((v) => (v.id === id ? { ...v, is_read: true } : v)));
    await (supabase as any).from("voicemails").update({ is_read: true }).eq("id", id);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this voicemail?")) return;
    const prev = voicemails;
    setVoicemails((v) => v.filter((x) => x.id !== id));
    const { error } = await (supabase as any).from("voicemails").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete voicemail");
      setVoicemails(prev);
    } else {
      toast.success("Voicemail deleted");
    }
  }, [voicemails]);

  const handleCallBack = useCallback(async (phone: string, contactId: string | null) => {
    try {
      await makeCall(phone, undefined, { contactId: contactId ?? undefined });
    } catch (err: any) {
      toast.error(err?.message || "Failed to start call");
    }
  }, [makeCall]);

  const personal = voicemails.filter((v) => v.agent_id === profile?.id);
  const org = voicemails.filter((v) => v.agent_id === null);
  const list = tab === "personal" ? personal : org;
  const personalUnread = personal.filter((v) => !v.is_read).length;
  const orgUnread = org.filter((v) => !v.is_read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <VoicemailIcon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Voicemail</h1>
          <p className="text-sm text-muted-foreground">
            {voicemails.filter((v) => !v.is_read).length} unread
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="personal" className="relative">
            My Voicemails
            {personalUnread > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs px-1.5 min-w-[20px] h-5">
                {personalUnread}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="org" className="relative">
            Team Inbox
            {orgUnread > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs px-1.5 min-w-[20px] h-5">
                {orgUnread}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Inbox className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-sm">No voicemails</p>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((vm) => (
                <VoicemailRow
                  key={vm.id}
                  voicemail={vm}
                  onMarkRead={handleMarkRead}
                  onDelete={handleDelete}
                  onCallBack={handleCallBack}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VoicemailInbox;
