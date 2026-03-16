import { supabase } from "@/integrations/supabase/client";
import { selectCallerID } from './caller-id-selector';

interface CampaignLead {
  id: string;
  phone: string;
  first_name: string;
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
  private autoDialEnabled: boolean;
  private dialDelaySeconds: number;
  private currentLeadIndex: number;
  private leadQueue: CampaignLead[];
  private phoneNumbers: PhoneNumber[];
  private dialTimeout: ReturnType<typeof setTimeout> | null;
  private localPresenceEnabled: boolean;

  constructor(sessionId: string, campaignId: string, agentId: string) {
    this.sessionId = sessionId;
    this.campaignId = campaignId;
    this.agentId = agentId;
    this.autoDialEnabled = true;
    this.dialDelaySeconds = 2;
    this.currentLeadIndex = 0;
    this.leadQueue = [];
    this.phoneNumbers = [];
    this.dialTimeout = null;
    this.localPresenceEnabled = true;
  }

  async startSession(): Promise<void> {
    // Load session settings
    const { data: session } = await supabase
      .from('dialer_sessions')
      .select('auto_dial_enabled, dial_delay_seconds')
      .eq('id', this.sessionId)
      .single();

    if (session) {
      this.autoDialEnabled = (session as any).auto_dial_enabled ?? true;
      this.dialDelaySeconds = (session as any).dial_delay_seconds ?? 2;
    }

    // Load campaign settings
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('local_presence_enabled')
      .eq('id', this.campaignId)
      .single();

    if (campaign) {
      this.localPresenceEnabled = (campaign as any).local_presence_enabled ?? true;
    }

    // Load phone numbers (cache for entire session)
    const { data: phones } = await supabase
      .from('phone_numbers')
      .select('*')
      .order('is_default', { ascending: false });

    this.phoneNumbers = (phones || []) as PhoneNumber[];

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
    const { data: dncRecord } = await supabase
      .from('dnc_list')
      .select('*')
      .eq('phone_number', lead.phone)
      .single();

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
    const { data: callRecord } = await supabase
      .from('calls')
      .insert({
        contact_id: lead.id,
        contact_type: 'lead',
        agent_id: this.agentId,
        campaign_id: this.campaignId,
        direction: 'outbound',
        caller_id_used: callerNumber,
        started_at: new Date().toISOString()
      } as any)
      .select()
      .single();

    // Emit event for UI to initiate call via TelnyxRTC
    window.dispatchEvent(new CustomEvent('auto-dial-call', {
      detail: {
        lead,
        callerNumber,
        callId: (callRecord as any)?.id
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

  async onCallEnd(disposition: Disposition): Promise<void> {
    console.log(`Call ended with disposition: ${disposition.name}`);

    // Mark lead as Called
    const lead = this.leadQueue[this.currentLeadIndex];
    await supabase
      .from('campaign_leads')
      .update({
        status: 'Called',
        last_called_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    if (!this.autoDialEnabled) {
      console.log('Auto-dial disabled, not advancing');
      return;
    }

    // Show countdown toast (emit event for UI)
    window.dispatchEvent(new CustomEvent('auto-dial-countdown', {
      detail: {
        delaySeconds: this.dialDelaySeconds,
        leadsRemaining: this.leadQueue.length - this.currentLeadIndex - 1
      }
    }));

    // Set timeout to dial next
    this.dialTimeout = setTimeout(() => {
      this.currentLeadIndex++;
      this.dialNext();
    }, this.dialDelaySeconds * 1000);
  }

  pauseAutoDialer(): void {
    console.log('Auto-dial paused');
    this.autoDialEnabled = false;
    if (this.dialTimeout) {
      clearTimeout(this.dialTimeout);
      this.dialTimeout = null;
    }
  }

  resumeAutoDialer(): void {
    console.log('Auto-dial resumed');
    this.autoDialEnabled = true;
    this.dialNext();
  }

  skipToNext(): void {
    console.log('Skipping to next lead');
    if (this.dialTimeout) {
      clearTimeout(this.dialTimeout);
      this.dialTimeout = null;
    }
    this.currentLeadIndex++;
    this.dialNext();
  }

  async endSession(): Promise<void> {
    console.log('Session ending');
    if (this.dialTimeout) {
      clearTimeout(this.dialTimeout);
    }

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
