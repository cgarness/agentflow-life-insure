import React from "react";
import { Lock, Phone as PhoneIcon } from "lucide-react";

// ─── Props ───────────────────────────────────────────────────────────────────

interface LeadCardBlurredProps {
  firstName: string;
  state: string | null;
  age: number | null;
  callAttempts: number;
  maxAttempts: number | null;
  lastDisposition: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function BlurField({ label }: { label: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
        {label}
      </div>
      <div className="relative mt-0.5">
        <div className="text-sm font-semibold text-foreground blur-[6px] select-none pointer-events-none">
          ████████
        </div>
        <Lock className="w-3 h-3 text-muted-foreground absolute inset-0 m-auto" />
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * LeadCardBlurred — ringing state view for Team/Open campaigns.
 *
 * Shows ONLY: first name, state, age, attempt counter, last disposition.
 * Sensitive fields (last name, phone, email, DOB, health, source, score,
 * spouse, notes) are rendered with a blur + lock icon overlay.
 *
 * Used exclusively by LeadCard when callStatus === 'ringing'.
 */
export default function LeadCardBlurred({
  firstName,
  state,
  age,
  callAttempts,
  maxAttempts,
  lastDisposition,
}: LeadCardBlurredProps) {
  const attemptsLabel =
    maxAttempts !== null ? `${callAttempts + 1} / ${maxAttempts}` : `${callAttempts + 1} / ∞`;

  return (
    <div className="p-4 flex-1 overflow-y-auto">
      {/* Calling pulse indicator */}
      <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg">
        <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
        <div className="flex items-center gap-1.5">
          <PhoneIcon className="w-3 h-3 text-primary" />
          <span className="text-[11px] font-bold text-primary uppercase tracking-widest font-mono">
            Calling · Attempt {callAttempts + 1}
          </span>
        </div>
      </div>

      {/* Visible fields */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="min-w-0 col-span-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            First Name
          </div>
          <div className="text-sm font-bold text-foreground mt-0.5 font-[Syne,sans-serif]">
            {firstName || "—"}
            <span className="text-muted-foreground">...</span>
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">State</div>
          <div className="text-sm font-semibold text-foreground mt-0.5">{state || "—"}</div>
        </div>

        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Age</div>
          <div className="text-sm font-semibold text-foreground mt-0.5">
            {age !== null ? age : "—"}
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Attempt</div>
          <div className="text-sm font-semibold text-foreground mt-0.5 font-mono">
            {attemptsLabel}
          </div>
        </div>

        {lastDisposition && (
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Last Result
            </div>
            <div className="text-sm font-semibold text-amber-400 mt-0.5 truncate">
              {lastDisposition}
            </div>
          </div>
        )}
      </div>

      {/* Blurred sensitive fields */}
      <div className="border-t border-border/50 pt-3">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold mb-3 flex items-center gap-1.5">
          <Lock className="w-2.5 h-2.5" />
          Revealed on connect
        </div>
        <div className="grid grid-cols-2 gap-4">
          <BlurField label="Last Name" />
          <BlurField label="Phone" />
          <BlurField label="Email" />
          <BlurField label="DOB" />
          <BlurField label="Health" />
          <BlurField label="Source" />
          <BlurField label="Score" />
          <BlurField label="Spouse" />
        </div>
      </div>
    </div>
  );
}
