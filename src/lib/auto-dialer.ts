import { supabase } from "@/integrations/supabase/client";
import { selectCallerID } from './caller-id-selector';
import { createCall } from './dialer-api';

interface CampaignLead {
  id: string;
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

interface Disposition {
  id: string;
  name: string;
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
        .select('local_presence_enabled')
        .eq('id', this.campaignId)
        .maybeSingle();

      this.localPresenceEnabled = (campaign as any)?.local_presence_enabled ?? true;
      if (!campaign) {
        console.warn(`[AutoDialer] campaigns row not found for id=${this.campaignId}, defaulting local_presence_enabled=true`);
      }
    } catch (err) {
      console.warn('[AutoDialer] Failed to load campaign settings, defaulting local_presence_enabled=true', err);
    }

    // Load phone numbers for this organization
    const { data: phones } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false });

    this.phoneNumbers = (phones || []) as unknown as PhoneNumber[];

    // Load lead queue
    const { data: leads } = await supabase
      .from('campaign_leads')
      .select('*')
      .eq('campaign_id', this.campaignId)
      .eq('status', 'Queued')
      .order('created_at', { ascending: true });

    // Filter out DNC numbers
    const { data: dncNumbers } = await supabase
      .from('dnc_list')
      .select('phone_number');

    const dncSet = new Set(dncNumbers?.map(d => d.phone_number) || []);
    this.leadQueue = ((leads || []) as CampaignLead[]).filter(lead => !dncSet.has(lead.phone));

    console.log(`Session started: ${this.leadQueue.length} leads in queue`);
  }

  async dialNext(): Promise<void> {
    if (!this.autoDialEnabled) {
      console.log('Auto-dial disabled, stopping');
      return;
    }

    if (this.currentLeadIndex >= this.leadQueue.length) {
      console.log('Queue empty, ending session');
      await this.endSession();
      return;
    }

    const lead = this.leadQueue[this.currentLeadIndex];

    // DNC check (double-check in case list changed)
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
      console.log('Lead on DNC list, emitting warning event');
      // Emit event for UI to show DNC warning modal
      window.dispatchEvent(new CustomEvent('dnc-warning', {
        detail: { lead, reason: (dncRecord as any).reason }
      }));
      return;
    }

    // Select caller ID using intelligent selection
    const callerNumber = await selectCallerID(
      lead,
      this.agentId,
      this.phoneNumbers,
      this.localPresenceEnabled
    );

    console.log(`Dialing lead ${lead.id} with caller ID ${callerNumber}`);

    // Create call record in database
    const callId = await createCall({
      contact_id: lead.id,
      agent_id: this.agentId,
      campaign_id: this.campaignId,
      caller_id_used: callerNumber,
      contact_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      contact_phone: lead.phone,
    }, this.organizationId);

    // Emit event for UI to initiate call via TelnyxRTC
    window.dispatchEvent(new CustomEvent('auto-dial-call', {
      detail: {
        lead,
        callerNumber,
        callId
      }
    }));

    // Increment daily call count for the used number
    const usedPhone = this.phoneNumbers.find(p => p.phone_number === callerNumber);
    if (usedPhone) {
      await supabase
        .from('phone_numbers')
        .update({ daily_call_count: usedPhone.daily_call_count + 1 } as any)
        .eq('phone_number', callerNumber);

      // Update local cache
      usedPhone.daily_call_count += 1;
    }
  }

  async saveDispositionAndNext(dispositionId: string, notes?: string): Promise<void> {
    const lead = this.leadQueue[this.currentLeadIndex];
    console.log(`Saving disposition ${dispositionId} for lead ${lead?.id}`);

    // Save disposition to existing call record
    try {
      await supabase
        .from('calls')
        .update({
          disposition_id: dispositionId,
          notes: notes || ''
        } as any)
        .eq('contact_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1);
    } catch (err) {
      console.warn('Disposition may not have saved:', err);
    }

    // Mark lead as Called
    await supabase
      .from('campaign_leads')
      .update({
        status: 'Called',
        last_called_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    if (this.autoDialEnabled) {
      // Advance to next lead and dial immediately (no countdown)
      this.currentLeadIndex++;
      window.dispatchEvent(new CustomEvent('auto-dial-next-lead', {
        detail: {
          leadsRemaining: this.leadQueue.length - this.currentLeadIndex
        }
      }));
      await this.dialNext();
    } else {
      // Auto-dial is OFF — just close the lead card
      console.log('Auto-dial disabled, closing lead card');
      window.dispatchEvent(new CustomEvent('auto-dial-lead-closed', {
        detail: { leadId: lead.id }
      }));
    }
  }

  pauseAutoDialer(): void {
    console.log('Auto-dial paused');
    this.autoDialEnabled = false;
  }

  resumeAutoDialer(): void {
    console.log('Auto-dial resumed');
    this.autoDialEnabled = true;
    this.dialNext();
  }

  async endSession(): Promise<void> {
    console.log('Session ending');

    // Emit event for UI to show end-of-session summary
    window.dispatchEvent(new CustomEvent('auto-dial-session-end', {
      detail: {
        sessionId: this.sessionId,
        totalLeads: this.leadQueue.length,
        leadsDialed: this.currentLeadIndex
      }
    }));

    // Update session record
    await supabase
      .from('dialer_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', this.sessionId);
  }
}
