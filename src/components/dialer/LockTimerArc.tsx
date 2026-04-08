/**
 * LockTimerArc — 90-second CSS arc that overlays the Call button
 * for Team and Open campaign types, reflecting the lock TTL window.
 *
 * Uses a conic-gradient animation driven by a CSS @keyframes rule
 * injected via Tailwind's arbitrary values. Tailwind-only, no
 * inline styles.
 *
 * Returns null for Personal campaigns or when inactive.
 */

import React, { useEffect, useState } from "react";

interface LockTimerArcProps {
  /** True when a lock is active (lead loaded in lock mode). */
  active: boolean;
  /** Campaign type string — returns null for Personal. */
  campaignType: string;
}

export default function LockTimerArc({ active, campaignType }: LockTimerArcProps) {
  const [running, setRunning] = useState(false);
  const type = campaignType.toUpperCase();

  // Personal campaigns: no arc
  if (type === "PERSONAL") return null;

  // Reset animation on active toggle
  useEffect(() => {
    if (active) {
      // Force re-mount of animation by toggling off then on
      setRunning(false);
      requestAnimationFrame(() => setRunning(true));
    } else {
      setRunning(false);
    }
  }, [active]);

  if (!running) return null;

  const isTeam = type === "TEAM";

  return (
    <div
      className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={`absolute inset-0 rounded-xl ${
          isTeam
            ? "animate-[lockArc_90s_linear_forwards]"
            : "animate-[lockArc_90s_linear_forwards]"
        }`}
        style={{
          /* Tailwind can't do dynamic conic-gradient in arbitrary, so we use
             a minimal CSS custom property approach. The animation is defined
             in the style tag below. */
          background: `conic-gradient(${
            isTeam ? "rgb(139 92 246 / 0.3)" : "rgb(245 158 11 / 0.3)"
          } var(--lock-progress, 0deg), transparent var(--lock-progress, 0deg))`,
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          WebkitMask:
            "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          animation: "lockArcSweep 90s linear forwards",
        }}
      />
      {/* Inject keyframes once */}
      <style>{`
        @keyframes lockArcSweep {
          from { --lock-progress: 0deg; }
          to   { --lock-progress: 360deg; }
        }
        @property --lock-progress {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
      `}</style>
    </div>
  );
}
