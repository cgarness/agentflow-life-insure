import { supabase } from "@/integrations/supabase/client";
import { selectCallerID } from './caller-id-selector';
import { createCall } from './dialer-api';

interface CampaignLead {
  id: string;       // campaign_lead junction row ID
  lead_id: string;  // master lead UUID from leads table
  phone: string;
  first_name: string;
  last_name: string;
  campaign_id: string;
  status: string;
}

interface PhoneNumber {
  id: string;
  phone_number: string;
  spam_status: 'Clean' | 'At Risk' | 'Flagged' | 'Unknown';
  spam_score: number;
  daily_call_count: number;
  daily_call_limit: number;
  is_default: boolean;
}

export class AutoDialer {
  private sessionId: string;
  private campaignId: string;
  private agentId: string;
  private organizationId: string | null;
  private autoDialEnabled: boolean;
  private currentLeadIndex: number;
  private leadQueue: CampaignLead[];
  private phoneNumbers: PhoneNumber[];
  private localPresenceEnabled: boolean;
  private maxAttempts: number = 1;
  private retryIntervalHours: number = 0;

  constructor(sessionId: string, campaignId: string, agentId: string, organizationId: string | null = null) {
    this.sessionId = sessionId;
    this.campaignId = campaignId;
    this.agentId = agentId;
    this.organizationId = organizationId;
    this.autoDialEnabled = true;
    this.currentLeadIndex = 0;
    this.leadQueue = [];
    this.phoneNumbers = [];
    this.localPresenceEnabled = true;
  }

  async startSession(): Promise<void> {
    // Load session settings
    try {
      const { data: session } = await supabase
        .from('dialer_sessions')
        .select('auto_dial_enabled')
        .eq('id', this.sessionId)
        .maybeSingle();

      this.autoDialEnabled = (session as any)?.auto_dial_enabled ?? true;
      if (!session) {
        console.warn(`[AutoDialer] dialer_sessions row not found for id=${this.sessionId}, defaulting auto_dial_enabled=true`);
      }
    } catch (err) {
      console.warn('[AutoDialer] Failed to load session settings, defaulting auto_dial_enabled=true', err);
    }

    // Load campaign settings
    try {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('local_presence_enabled, max_attempts, retry_interval_hours')
        .eq('id', this.campaignId)
        .maybeSingle();

      this.localPresenceEnabled = (campaign as any)?.local_presence_enabled ?? true;
      this.maxAttempts = (campaign as any)?.max_attempts ?? 1;
      this.retryIntervalHours = (campaign as any)?.retry_interval_hours ?? 0;

      if (!campaign) {
        console.warn(`[AutoDialer] campaigns row not found for id=${this.campaignId}, using defaults`);
      }
    } catch (err) {
      console.warn('[AutoDialer] Failed to load campaign settings', err);
    }

    // Load phone numbers for this organization
    const { data: phones } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false });

    this.phoneNumbers = (phones || []) as unknown as PhoneNumber[];

    // Load lead queue — join leads table to get master lead ID + full lead data.
    // Filter matches getCampaignLeads in dialer-api.ts so both queues are aligned.
    const { data: rawLeads } = await supabase
      .from('campaign_leads')
      .select('*, lead:leads(*)')
      .eq('campaign_id', this.campaignId)
      .not('status', 'in', '("DNC","Completed","Removed")')
      .order('created_at', { ascending: true });

    // Flatten joined data so lead fields are accessible at top level
    const leads = (rawLeads || []).map((row: any) => {
      const { lead, ...campaignLead } = row;
      return {
        ...(lead || {}),
        ...campaignLead,
        id: campaignLead.id,
        lead_id: lead?.id || campaignLead.lead_id,
      };
    });

    // Filter by DNC, max attempts, and retry interval in JS
    const { data: dncNumbers } = await supabase
      .from('dnc_list')
      .select('phone_number');

    const dncSet = new Set(dncNumbers?.map(d => d.phone_number) || []);
    const now = new Date();

    this.leadQueue = ((leads || []) as any[]).filter(lead => {
      if (dncSet.has(lead.phone)) return false;

      if (lead.status === "Queued") return true;

      if (lead.status === "Called") {
        const attempts = lead.call_attempts ?? 0;
        if (attempts >= this.maxAttempts) return false;

        if (this.retryIntervalHours > 0 && lead.last_called_at) {
          const lastCalled = new Date(lead.last_called_at);
          const hoursSince = (now.getTime() - lastCalled.getTime()) / (1000 * 60 * 60);
          if (hoursSince < this.retryIntervalHours) return false;
        }
        return true;
      }

      return false;
    });

    console.log(`[AutoDialer] Session started: ${this.leadQueue.length} leads in queue, org=${this.organizationId}, phones=${this.phoneNumbers.length}`);
  }

  async dialNext(): Promise<void> {
    if (!this.autoDialEnabled) {
      console.log('[AutoDialer] Auto-dial disabled, stopping');
      return;
    }

    if (this.currentLeadIndex >= this.leadQueue.length) {
      console.log('[AutoDialer] Queue empty, ending session');
      await this.endSession();
      return;
    }

    const lead = this.leadQueue[this.currentLeadIndex];

    // DNC double-check in case list changed since session start
    let dncRecord: Record<string, unknown> | null = null;
    try {
      const { data } = await supabase
        .from('dnc_list')
        .select('*')
        .eq('phone_number', lead.phone)
        .maybeSingle();
      dncRecord = data as Record<string, unknown> | null;
    } catch (err) {
      console.warn('[AutoDialer] DNC check failed, proceeding without DNC verification', err);
    }

    if (dncRecord) {
      console.log('[AutoDialer] Lead on DNC list, emitting warning event');
      window.dispatchEvent(new CustomEvent('dnc-warning', {
        detail: { lead, reason: (dncRecord as any).reason }
      }));
      return;
    }

    // Select caller ID using intelligent local-presence selection
    const callerNumber = await selectCallerID(
      lead,
      this.agentId,
      this.phoneNumbers,
      this.localPresenceEnabled
    );

    console.log(`[AutoDialer] Dialing lead ${lead.lead_id || lead.id} with caller ID ${callerNumber}`);

    // Create call record — use lead_id (master contact ID), not id (junction row ID)
    const callId = await createCall({
      contact_id: lead.lead_id || lead.id,
      agent_id: this.agentId,
      campaign_id: this.campaignId,
      caller_id_used: callerNumber,
      contact_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      contact_phone: lead.phone,
    }, this.organizationId);

    // Emit event for UI to initiate call via TelnyxRTC
    window.dispatchEvent(new CustomEvent('auto-dial-call', {
      detail: { lead, callerNumber, callId }
    }));

    // Increment daily call count for the used number
    const usedPhone = this.phoneNumbers.find(p => p.phone_number === callerNumber);
    if (usedPhone) {
      await supabase
        .from('phone_numbers')
        .update({ daily_call_count: usedPhone.daily_call_count + 1 } as any)
        .eq('phone_number', callerNumber);
      usedPhone.daily_call_count += 1;
    }
  }

  async saveDispositionAndNext(dispositionId: string, notes?: string): Promise<void> {
    const lead = this.leadQueue[this.currentLeadIndex];
    console.log(`[AutoDialer] Saving disposition ${dispositionId} for lead ${lead?.lead_id || lead?.id}`);

    // Save disposition to existing call record (match by master lead ID)
    try {
      await supabase
        .from('calls')
        .update({
          disposition_id: dispositionId,
          notes: notes || ''
        } as any)
        .eq('contact_id', lead.lead_id || lead.id)
        .order('created_at', { ascending: false })
        .limit(1);
    } catch (err) {
      console.warn('[AutoDialer] Disposition may not have saved:', err);
    }

    // Note: status, call_attempts, and last_called_at are handled by dialer-api's updateLeadStatus
    // which is called by the DialerPage before this method.
    // Redundant update removed to prevent race conditions or stale data overwrites.

    if (this.autoDialEnabled) {
      this.currentLeadIndex++;
      window.dispatchEvent(new CustomEvent('auto-dial-next-lead', {
        detail: { leadsRemaining: this.leadQueue.length - this.currentLeadIndex }
      }));
      await this.dialNext();
    } else {
      console.log('[AutoDialer] Auto-dial disabled, closing lead card');
      window.dispatchEvent(new CustomEvent('auto-dial-lead-closed', {
        detail: { leadId: lead.id }
      }));
    }
  }

  pauseAutoDialer(): void {
    console.log('[AutoDialer] Paused');
    this.autoDialEnabled = false;
  }

  resumeAutoDialer(): void {
    console.log('[AutoDialer] Resumed');
    this.autoDialEnabled = true;
    this.dialNext();
  }

  /** Synchronize the internal lead index with the UI's currentLeadIndex */
  setIndex(index: number): void {
    this.currentLeadIndex = index;
  }

  /** Get the current internal lead index */
  getIndex(): number {
    return this.currentLeadIndex;
  }

  /** Check if auto-dial is currently enabled */
  isEnabled(): boolean {
    return this.autoDialEnabled;
  }

  async endSession(): Promise<void> {
    console.log('[AutoDialer] Session ending');

    window.dispatchEvent(new CustomEvent('auto-dial-session-end', {
      detail: {
        sessionId: this.sessionId,
        totalLeads: this.leadQueue.length,
        leadsDialed: this.currentLeadIndex
      }
    }));

    await supabase
      .from('dialer_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', this.sessionId);
  }
}
