import { supabase } from "@/integrations/supabase/client";

export interface ConversationPreview {
  contact_id: string;
  contact_name: string;
  contact_type: 'lead' | 'client' | 'recruit';
  contact_phone?: string;
  contact_email?: string;
  last_message: string;
  last_message_at: string;
  channel: 'sms' | 'email' | 'call';
  direction: 'inbound' | 'outbound';
}

export const messagesSupabaseApi = {
  async getRecentConversations(): Promise<ConversationPreview[]> {
    // This is a simplified version. In a real-world app, you might use a database view or RPC.
    // For now, we'll fetch recent activities and merge them.
    
    const [smsRes, emailRes, callRes] = await Promise.all([
      supabase
        .from('messages')
        .select('lead_id, body, sent_at, direction')
        .order('sent_at', { ascending: false })
        .limit(50),
      supabase
        .from('contact_emails')
        .select('contact_id, body_text, created_at, direction, subject')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('calls')
        .select('contact_id, contact_name, direction, created_at, disposition_name')
        .order('created_at', { ascending: false })
        .limit(50)
    ]);

    const items: any[] = [];

    (smsRes.data || []).forEach(m => {
      if (!m.lead_id) return;
      items.push({
        contact_id: m.lead_id,
        last_message: m.body,
        last_message_at: m.sent_at || m.created_at,
        channel: 'sms',
        direction: m.direction
      });
    });

    (emailRes.data || []).forEach(e => {
      if (!e.contact_id) return;
      items.push({
        contact_id: e.contact_id,
        last_message: e.subject || e.body_text || '(No subject)',
        last_message_at: e.created_at,
        channel: 'email',
        direction: e.direction
      });
    });

    (callRes.data || []).forEach(c => {
      if (!c.contact_id) return;
      items.push({
        contact_id: c.contact_id,
        last_message: c.disposition_name || 'Call',
        last_message_at: c.created_at,
        channel: 'call',
        direction: c.direction
      });
    });

    // Group by contact_id and get latest
    const grouped = new Map<string, any>();
    items.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
    
    items.forEach(item => {
      if (!grouped.has(item.contact_id)) {
        grouped.set(item.contact_id, item);
      }
    });

    const recent = Array.from(grouped.values()).slice(0, 50);

    // Fetch contact details for these IDs
    const contactIds = recent.map(r => r.contact_id);
    if (contactIds.length === 0) return [];

    // We check leads, clients, and recruits
    const [leads, clients, recruits] = await Promise.all([
      supabase.from('leads').select('id, first_name, last_name').in('id', contactIds),
      supabase.from('clients').select('id, first_name, last_name').in('id', contactIds),
      supabase.from('recruits').select('id, first_name, last_name').in('id', contactIds)
    ]);

    const contactMap = new Map<string, { name: string; type: 'lead' | 'client' | 'recruit'; phone?: string; email?: string }>();
    (leads.data || []).forEach(l => contactMap.set(l.id, { name: `${l.first_name} ${l.last_name}`, type: 'lead', phone: l.phone, email: l.email }));
    (clients.data || []).forEach(c => contactMap.set(c.id, { name: `${c.first_name} ${c.last_name}`, type: 'client', phone: c.phone, email: c.email }));
    (recruits.data || []).forEach(r => contactMap.set(r.id, { name: `${r.first_name} ${r.last_name}`, type: 'recruit', phone: r.phone, email: r.email }));

    return recent.map(r => {
      const contact = contactMap.get(r.contact_id);
      return {
        ...r,
        contact_name: contact?.name || 'Unknown Contact',
        contact_type: contact?.type || 'lead',
        contact_phone: contact?.phone,
        contact_email: contact?.email
      };
    });
  },

  async getConversationThread(contactId: string): Promise<any[]> {
    const [callsRes, msgsRes, emailsRes] = await Promise.all([
      supabase
        .from("calls")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("messages")
        .select("*")
        .eq("lead_id", contactId)
        .order("sent_at", { ascending: false })
        .limit(100),
      supabase
        .from("contact_emails")
        .select("*")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const calls = (callsRes.data || []).map(c => ({
      ...c,
      type: "call",
      _ts: new Date(c.started_at || c.created_at || 0).getTime(),
      description: c.disposition_name || "Call",
    }));
    const msgs = (msgsRes.data || []).map(m => ({
      ...m,
      type: "sms",
      _ts: new Date(m.sent_at || m.created_at || 0).getTime(),
      description: m.body,
    }));
    const emails = (emailsRes.data || []).map(e => ({
      ...e,
      type: "email",
      _ts: new Date(e.received_at || e.sent_at || e.created_at || 0).getTime(),
      description: e.body_text || e.body_html || "(No content)",
    }));

    return [...calls, ...msgs, ...emails].sort((a, b) => a._ts - b._ts);
  }
};
