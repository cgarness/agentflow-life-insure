import { supabase } from "@/integrations/supabase/client";
import { selectCallerID } from './caller-id-selector';
import { createCall } from './dialer-api';

/** Maps US state abbreviations to their primary IANA timezone. */
const STATE_TO_TZ: Record<string, string> = {
  // Eastern
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', IN: 'America/New_York', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/New_York',
  NH: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York',
  NC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/Chicago',
  LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago',
  OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', WI: 'America/Chicago',
  // Mountain
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Denver',
  MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver',
  WY: 'America/Denver',
  // Pacific
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
  // Non-contiguous
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

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
  private callingHoursStart: string = '09:00';
  private callingHoursEnd: string = '21:00';
  private ringTimeout: number = 20;
  private amdEnabled: boolean = false;

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
      let sessionQuery = supabase
        .from('dialer_sessions')
        .select('auto_dial_enabled')
        .eq('id', this.sessionId);
      
      if (this.organizationId) {
        sessionQuery = sessionQuery.eq('organization_id', this.organizationId);
      }

      const { data: session } = await sessionQuery.maybeSingle();

      this.autoDialEnabled = (session as any)?.auto_dial_enabled ?? true;
      if (!session) {
        console.warn(`[AutoDialer] dialer_sessions row not found for id=${this.sessionId}, defaulting auto_dial_enabled=true`);
      }
    } catch (err) {
      console.warn('[AutoDialer] Failed to load session settings, defaulting auto_dial_enabled=true', err);
    }

    // Load campaign settings
    try {
      let campaignQuery = supabase
        .from('campaigns')
        .select('local_presence_enabled, max_attempts, retry_interval_hours, calling_hours_start, calling_hours_end')
        .eq('id', this.campaignId);

      if (this.organizationId) {
        campaignQuery = campaignQuery.eq('organization_id', this.organizationId);
      }

      const { data: campaign } = await campaignQuery.maybeSingle();

      this.localPresenceEnabled = (campaign as any)?.local_presence_enabled ?? true;
      this.maxAttempts = (campaign as any)?.max_attempts ?? 1;
      this.retryIntervalHours = (campaign as any)?.retry_interval_hours ?? 0;
      this.callingHoursStart = ((campaign as any)?.calling_hours_start as string)?.slice(0, 5) ?? '09:00';
      this.callingHoursEnd = ((campaign as any)?.calling_hours_end as string)?.slice(0, 5) ?? '21:00';

      if (!campaign) {
        console.warn(`[AutoDialer] campaigns row not found for id=${this.campaignId}, using defaults`);
      }
    } catch (err) {
      console.warn('[AutoDialer] Failed to load campaign settings', err);
    }

    // Load phone settings (ring timeout + AMD) for this organization
    if (this.organizationId) {
      try {
        const { data: phoneSettings } = await supabase
          .from('phone_settings')
          .select('ring_timeout, amd_enabled')
          .eq('organization_id', this.organizationId)
          .maybeSingle();

        if (phoneSettings) {
          this.ringTimeout = (phoneSettings as any).ring_timeout ?? 20;
          this.amdEnabled = (phoneSettings as any).amd_enabled ?? false;
        }
      } catch (err) {
        console.warn('[AutoDialer] Failed to load phone settings, using defaults', err);
      }
    }

    // Load phone numbers for this organization
    const { data: phones } = await supabase
      .from('phone_numbers')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('status', 'active')
      .order('is_default', { ascending: false });

    this.phoneNumbers = (phones || []) as unknown as PhoneNumber[];

    // We no longer load the lead queue here.
    // The DialerPage injects its live query results via setQueue() to keep them perfectly synced.

    console.log(`[AutoDialer] Session started: org=${this.organizationId}, phones=${this.phoneNumbers.length}`);
  }

  /** Synchronize the internal lead queue with the UI's queue */
  async setQueue(leads: any[]): Promise<void> {
    // We just maintain the exact queue from the UI so that currentLeadIndex matches perfectly.
    // DNC checks happen at the time of dialing (dialNext) via the dnc-warning event.
    this.leadQueue = leads;
    console.log(`[AutoDialer] Queue synced from UI. ${this.leadQueue.length} leads.`);
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
    let dncRecord: any = null;
    try {
      let dncQuery = supabase
        .from('dnc_list')
        .select('*')
        .eq('phone_number', lead.phone);
      
      if (this.organizationId) {
        dncQuery = dncQuery.eq('organization_id', this.organizationId);
      }
      
      const { data } = await dncQuery.maybeSingle();
      dncRecord = data;
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
      campaign_lead_id: lead.id,
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
      let phoneUpdateQuery = supabase
        .from('phone_numbers')
        .update({ daily_call_count: usedPhone.daily_call_count + 1 } as any)
        .eq('phone_number', callerNumber);

      if (this.organizationId) {
        phoneUpdateQuery = phoneUpdateQuery.eq('organization_id', this.organizationId);
      }

      await phoneUpdateQuery;
      usedPhone.daily_call_count += 1;
    }
  }

  async saveDispositionAndNext(dispositionId: string, notes?: string): Promise<void> {
    const lead = this.leadQueue[this.currentLeadIndex];
    if (!lead) return;
    
    console.log(`[AutoDialer] Saving disposition ${dispositionId} for lead ${lead.lead_id || lead.id}`);

    // Save disposition to existing call record (match by master lead ID)
    try {
      let callUpdateQuery = supabase
        .from('calls')
        .update({
          disposition_id: dispositionId,
          notes: notes || ''
        } as any)
        .eq('contact_id', lead.lead_id || lead.id);

      if (this.organizationId) {
        callUpdateQuery = callUpdateQuery.eq('organization_id', this.organizationId);
      }

      await callUpdateQuery
        .order('created_at', { ascending: false })
        .limit(1);
    } catch (err) {
      console.warn('[AutoDialer] Disposition may not have saved:', err);
    }

    if (this.autoDialEnabled) {
      this.currentLeadIndex++;
      window.dispatchEvent(new CustomEvent('auto-dial-next-lead', {
        detail: { leadsRemaining: this.leadQueue.length - this.currentLeadIndex }
      }));
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

  /**
   * Returns true if the current local time in the lead's state is within the
   * campaign's configured calling hours window.
   * Defaults to Eastern time when the state is unrecognized.
   */
  checkCallingHours(leadState: string): boolean {
    if (!this.callingHoursStart || !this.callingHoursEnd) return true;
    const tz = STATE_TO_TZ[leadState?.toUpperCase()] ?? 'America/New_York';
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const rawHour = parts.find(p => p.type === 'hour')?.value ?? '00';
    const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
    // '24' can occur at midnight in some locales — normalize to '00'
    const h = parseInt(rawHour, 10) % 24;
    const current = `${String(h).padStart(2, '0')}:${minute.padStart(2, '0')}`;
    return current >= this.callingHoursStart && current < this.callingHoursEnd;
  }

  /** Returns the ring timeout in seconds loaded from phone_settings (default 20). */
  getRingTimeout(): number {
    return this.ringTimeout;
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

    let sessionEndQuery = supabase
      .from('dialer_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', this.sessionId);

    if (this.organizationId) {
      sessionEndQuery = sessionEndQuery.eq('organization_id', this.organizationId);
    }

    await sessionEndQuery;
  }
}
