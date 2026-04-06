/**
 * queue-manager.ts
 *
 * All queue lifecycle logic for the AgentFlow Power Dialer.
 * Keeps DialerPage.tsx clean by centralizing priority sorting,
 * disposition-driven re-insertion, and time-based eligibility.
 *
 * In-memory only — no Supabase mutations here.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Extends the raw campaign_leads row with two in-memory-only fields.
 * These are never written to the database — they exist only in the
 * local leadQueue array for the duration of the dialer session.
 */
export interface CampaignLead {
  id: string;
  lead_id?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  state?: string;
  status?: string;
  call_attempts?: number;
  last_called_at?: string | null;
  callback_at?: string | null;
  scheduled_callback_at?: string | null;
  // ── In-memory lifecycle fields (never persisted) ──
  retry_eligible_at?: string | null;
  callback_due_at?: string | null;
  [key: string]: unknown;
}

type QueueBehavior =
  | { action: 'remove_until_retry' }
  | { action: 'remove_until_callback' }
  | { action: 'remove_permanent' }
  | { action: 'keep_at_bottom' };

// ─── Disposition Behavior Map ─────────────────────────────────────────────────

const DISPOSITION_QUEUE_BEHAVIOR: Record<string, QueueBehavior> = {
  'No Answer':       { action: 'remove_until_retry' },
  'Not Available':   { action: 'remove_until_retry' },
  'Left Voicemail':  { action: 'remove_until_retry' },
  'Interested':      { action: 'remove_until_retry' },
  'Not Interested':  { action: 'remove_permanent' },
  'DNC':             { action: 'remove_permanent' },
  'Appointment Set': { action: 'remove_permanent' },
  'Appt Set':        { action: 'remove_permanent' },
  'Call Back':       { action: 'remove_until_callback' },
  'Call Back Later': { action: 'remove_until_callback' },
};

// ─── Tier Detection ───────────────────────────────────────────────────────────

/**
 * Returns the priority tier for a lead (1–4).
 *
 * Tier 1 — Callback Due Now  : callback_due_at is set AND <= now
 * Tier 2 — New Lead          : call_attempts === 0, no retry/callback timestamps
 * Tier 3 — Retry Eligible    : retry_eligible_at is set AND <= now
 * Tier 4 — Pending           : any timestamp is set but still in the future
 */
export function getLeadTier(lead: CampaignLead, now: Date): 1 | 2 | 3 | 4 {
  const callbackDue = lead.callback_due_at;
  const retryAt    = lead.retry_eligible_at;

  if (callbackDue && new Date(callbackDue) <= now) return 1;
  if (!callbackDue && !retryAt && (lead.call_attempts ?? 0) === 0) return 2;
  if (retryAt && new Date(retryAt) <= now) return 3;
  return 4;
}

// ─── sortQueue ────────────────────────────────────────────────────────────────

/**
 * Stable, priority-tiered sort of the lead queue.
 * Never mutates the input array.
 */
export function sortQueue(leads: CampaignLead[], now: Date): CampaignLead[] {
  const tiered = leads.map((lead, originalIndex) => ({
    lead,
    tier: getLeadTier(lead, now),
    originalIndex,
  }));

  tiered.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;

    // Within Tier 4: soonest due timestamp first
    if (a.tier === 4) {
      const aTs = a.lead.retry_eligible_at || a.lead.callback_due_at || '';
      const bTs = b.lead.retry_eligible_at || b.lead.callback_due_at || '';
      if (aTs && bTs) return new Date(aTs).getTime() - new Date(bTs).getTime();
    }

    // Same tier, no special ordering — preserve original relative order (stable)
    return a.originalIndex - b.originalIndex;
  });

  return tiered.map(({ lead }) => lead);
}

// ─── applyDispositionToQueue ──────────────────────────────────────────────────

/**
 * Applies a disposition's queue behavior to the live lead array.
 * Returns a new sorted array — never mutates the input.
 *
 * @param leads              Current leadQueue array
 * @param disposedLead       The lead that was just dispositioned
 * @param dispositionName    The disposition name string
 * @param retryIntervalHours Hours before a retry-eligible lead re-enters callable tier
 * @param callbackDueAt      ISO timestamp for scheduled callback (null if not provided)
 * @param now                Current Date (injected for testability)
 */
export function applyDispositionToQueue(
  leads: CampaignLead[],
  disposedLead: CampaignLead,
  dispositionName: string,
  retryIntervalHours: number,
  callbackDueAt: string | null,
  now: Date,
): CampaignLead[] {
  // 1. Remove disposed lead from its current position
  const without = leads.filter(l => l.id !== disposedLead.id);

  // 2. Look up behavior (default: keep_at_bottom)
  const behavior: QueueBehavior =
    DISPOSITION_QUEUE_BEHAVIOR[dispositionName] ?? { action: 'keep_at_bottom' };

  switch (behavior.action) {
    case 'remove_permanent':
      return sortQueue(without, now);

    case 'remove_until_retry': {
      const eligibleAt = new Date(now.getTime() + retryIntervalHours * 3_600_000).toISOString();
      const updated: CampaignLead = {
        ...disposedLead,
        retry_eligible_at: eligibleAt,
        callback_due_at: null,
      };
      return sortQueue([...without, updated], now);
    }

    case 'remove_until_callback': {
      let dueAt: string;
      if (callbackDueAt) {
        dueAt = callbackDueAt;
      } else {
        console.warn(
          '[queue-manager] remove_until_callback: no callbackDueAt provided — defaulting to 48h from now',
        );
        dueAt = new Date(now.getTime() + 48 * 3_600_000).toISOString();
      }
      const updated: CampaignLead = {
        ...disposedLead,
        callback_due_at: dueAt,
        retry_eligible_at: null,
      };
      return sortQueue([...without, updated], now);
    }

    case 'keep_at_bottom':
    default: {
      const updated: CampaignLead = {
        ...disposedLead,
        retry_eligible_at: null,
        callback_due_at: null,
      };
      return sortQueue([...without, updated], now);
    }
  }
}

// ─── queueOrderChanged ────────────────────────────────────────────────────────

/**
 * Returns true if any lead ID differs at the same position between two arrays.
 * Used to decide whether to trigger a toast + UI refresh on the 60-second poll.
 */
export function queueOrderChanged(
  a: CampaignLead[],
  b: CampaignLead[],
): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return true;
  }
  return false;
}

// ─── formatTimeUntil ─────────────────────────────────────────────────────────

/**
 * Returns a human-readable countdown string from now to a future ISO timestamp.
 *
 * Examples:
 *   "Retry in 2h 30m"
 *   "Callback in 1d 4h"
 *   "Due now"
 */
export function formatTimeUntil(isoTimestamp: string, now: Date): string {
  const target = new Date(isoTimestamp);
  const diffMs  = target.getTime() - now.getTime();

  if (diffMs <= 0) return 'Due now';

  const totalMinutes = Math.floor(diffMs / 60_000);
  const totalHours   = Math.floor(totalMinutes / 60);
  const days         = Math.floor(totalHours / 24);
  const hours        = totalHours % 24;
  const minutes      = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}
