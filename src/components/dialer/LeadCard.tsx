import React, { useRef, useEffect, useState } from "react";
import LeadCardBlurred from "./LeadCardBlurred";
import { LeadInfoSkeleton } from "./DialerSkeletons";
import { formatTimeUntil } from "@/lib/queue-manager";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CallStatus = "idle" | "ringing" | "connected";

interface LeadCardProps {
  /** Raw campaign_leads row merged with leads data (snake_case fields). */
  lead: Record<string, unknown> | null;
  /**
   * idle     → no lead data visible ("Next lead loading…")
   * ringing  → partial reveal (first name, state, age, attempts) + blurred fields
   * connected → full reveal, all fields visible
   *
   * Personal campaigns always receive 'connected' regardless of actual call state.
   */
  callStatus: CallStatus;
  /** Number of call attempts already made on this campaign_lead. */
  callAttempts: number;
  /** Campaign max_attempts. null = unlimited. */
  maxAttempts: number | null;
  /** Last disposition string from history, if any. */
  lastDisposition: string | null;
  /** True when this lead's master ID is in useHardClaim.claimedLeadIds. */
  isClaimed: boolean;
  /** Inline editing state — forwarded from DialerPage. */
  isEditing: boolean;
  editForm: Record<string, unknown>;
  onEditChange: (key: string, value: string) => void;
  isAdvancing?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  fieldKey,
  isEditing,
  editForm,
  onEditChange,
}: {
  label: string;
  value: unknown;
  fieldKey: string;
  isEditing: boolean;
  editForm: Record<string, unknown>;
  onEditChange: (key: string, val: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
        {label}
      </div>
      {isEditing ? (
        <input
          type="text"
          value={String(editForm[fieldKey] ?? "")}
          onChange={(e) => onEditChange(fieldKey, e.target.value)}
          className="w-full bg-accent/50 border border-border rounded px-1.5 py-0.5 text-xs text-foreground mt-0.5 focus:ring-1 focus:ring-primary outline-none"
        />
      ) : (
        <div className="text-sm font-semibold text-foreground mt-0.5 truncate">
          {String(value || "—")}
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * LeadCard — staged lead reveal for campaign-aware dialer.
 *
 * Renders the scrollable details area inside the left column contact card.
 * The header (name, arrows, edit/view buttons) is rendered by DialerPage.
 *
 * Three explicit states:
 *   idle      → placeholder
 *   ringing   → LeadCardBlurred (partial reveal)
 *   connected → full field grid
 */
export default function LeadCard({
  lead,
  callStatus,
  callAttempts,
  maxAttempts,
  lastDisposition,
  isClaimed,
  isEditing,
  editForm,
  onEditChange,
  isAdvancing,
}: LeadCardProps) {
  // Track lead ID for fade transition on lead change
  const prevLeadId = useRef<string | null>(null);
  const [fadeIn, setFadeIn] = useState(true);

  const leadId = (lead?.id || lead?.lead_id || null) as string | null;

  useEffect(() => {
    if (leadId && prevLeadId.current && leadId !== prevLeadId.current) {
      // New lead arrived — trigger a quick fade-in
      setFadeIn(false);
      const raf = requestAnimationFrame(() => setFadeIn(true));
      return () => cancelAnimationFrame(raf);
    }
    prevLeadId.current = leadId;
  }, [leadId]);

  // ── idle ──────────────────────────────────────────────────────────────────
  if (callStatus === "idle" || !lead || isAdvancing) {
    return (
      <div className="p-4 flex-1">
        <LeadInfoSkeleton />
      </div>
    );
  }

  // ── ringing ───────────────────────────────────────────────────────────────
  if (callStatus === "ringing") {
    return (
      <LeadCardBlurred
        firstName={String(lead.first_name || "")}
        state={lead.state ? String(lead.state) : null}
        age={lead.age !== undefined && lead.age !== null ? Number(lead.age) : null}
        callAttempts={callAttempts}
        maxAttempts={maxAttempts}
        lastDisposition={lastDisposition}
      />
    );
  }

  // ── connected ─────────────────────────────────────────────────────────────
  const fields = [
    { label: "First Name", key: "first_name" },
    { label: "Last Name", key: "last_name" },
    { label: "Phone", key: "phone" },
    { label: "Email", key: "email" },
    { label: "State", key: "state" },
    { label: "Age", key: "age" },
    { label: "DOB", key: "date_of_birth" },
    { label: "Health", key: "health_status" },
    { label: "Best Time", key: "best_time_to_call" },
    { label: "Spouse", key: "spouse_info" },
    { label: "Source", key: "source" },
  ];

  const now = new Date();
  const ts = String(lead.retry_eligible_at || lead.callback_due_at || "");
  const tier4Label = ts && new Date(ts) > now
    ? (lead.callback_due_at
        ? `Warning: Available for callback in ${formatTimeUntil(ts, now)}`
        : `Warning: Available for retry in ${formatTimeUntil(ts, now)}`)
    : null;

  return (
    <div
      className="p-4 flex-1 overflow-y-auto"
      style={{
        transition: "opacity 150ms ease-in",
        opacity: fadeIn ? 1 : 0,
      }}
    >
      {tier4Label && (
        <div className="flex flex-col mb-4 p-3 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500">
          <span className="text-xs font-bold uppercase tracking-wider">{tier4Label}</span>
        </div>
      )}

      {/* Claimed badge */}
      {isClaimed && (
        <div
          className="flex items-center gap-1.5 mb-3 text-[11px] font-bold font-mono animate-in fade-in duration-500"
          style={{ color: "#22c55e" }}
        >
          <span>✦</span>
          <span>Claimed</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            value={lead[f.key]}
            fieldKey={f.key}
            isEditing={isEditing}
            editForm={editForm}
            onEditChange={onEditChange}
          />
        ))}
      </div>
    </div>
  );
}
