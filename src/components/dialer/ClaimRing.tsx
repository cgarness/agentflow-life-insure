import React, { useEffect, useRef, useState } from "react";

// ─── Constants ───────────────────────────────────────────────────────────────

const RADIUS = 40;
const STROKE_WIDTH = 3;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CLAIM_DURATION_MS = 30_000;
const COMPLETE_LINGER_MS = 600;

// ─── Props ───────────────────────────────────────────────────────────────────

interface ClaimRingProps {
  /** True when call is connected AND campaign is Team or Open. */
  active: boolean;
  /**
   * Fired when the 30s arc completes. This is a UI signal only —
   * the actual claim_lead RPC is called by useHardClaim, not here.
   */
  onClaim: () => void;
  /** Campaign type — returns null for Personal. */
  campaignType: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ClaimRing — 30-second SVG arc that overlays the Call button.
 *
 * Visual only. Does not touch the database.
 * Returns null for Personal campaigns.
 * Uses a JS ref for the timer and CSS transitions for the animation.
 */
export default function ClaimRing({
  active,
  onClaim,
  campaignType,
}: ClaimRingProps) {
  const circleRef = useRef<SVGCircleElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // cancelledRef lets the rAF double-callback bail out if active flipped
  // to false before both frames fired — prevents mid-reset arc restart.
  const cancelledRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [completed, setCompleted] = useState(false);

  const type = campaignType.toUpperCase();
  const isTeam = type === "TEAM";
  const isPersonal = type === "PERSONAL";

  // Stroke colour: purple for Team, amber for Open
  const strokeColor = isTeam ? "#8b5cf6" : "#f59e0b";

  useEffect(() => {
    const circle = circleRef.current;
    if (!circle) return;

    if (active) {
      cancelledRef.current = false;

      // Hard-reset position with transition disabled first.
      circle.style.transition = "none";
      circle.style.strokeDashoffset = String(CIRCUMFERENCE);
      circle.style.stroke = strokeColor;
      setVisible(true);
      setCompleted(false);

      // Two rAF hops ensure the browser has painted the reset before we
      // enable the transition — otherwise the browser may skip the jump.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // If active flipped false before we get here, do nothing — the
          // else branch already reset the circle synchronously.
          if (cancelledRef.current) return;
          circle.style.transition = `stroke-dashoffset ${CLAIM_DURATION_MS}ms linear`;
          circle.style.strokeDashoffset = "0";
        });
      });

      // JS timer fires onClaim after 30s
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (cancelledRef.current) return;
        if (circle) circle.style.stroke = "#22c55e";
        setCompleted(true);
        onClaim();
        // Fade out after brief green flash
        setTimeout(() => setVisible(false), COMPLETE_LINGER_MS);
      }, CLAIM_DURATION_MS);
    } else {
      // Mark cancelled so any pending rAF callback does not overwrite this reset.
      cancelledRef.current = true;

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Instant visual reset — no transition.
      circle.style.transition = "none";
      circle.style.strokeDashoffset = String(CIRCUMFERENCE);
      setVisible(false);
      setCompleted(false);
    }

    return () => {
      cancelledRef.current = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Personal campaigns: no ring
  if (isPersonal) return null;

  return (
    <svg
      width="100"
      height="100"
      viewBox="0 0 100 100"
      className="absolute inset-0 pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transition: completed ? `opacity ${COMPLETE_LINGER_MS}ms ease-out` : "none",
      }}
      aria-hidden="true"
    >
      {/* Background track */}
      <circle
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        className="text-muted/20"
      />
      {/* Animated arc */}
      <circle
        ref={circleRef}
        cx="50"
        cy="50"
        r={RADIUS}
        fill="none"
        stroke={strokeColor}
        strokeWidth={STROKE_WIDTH}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE}
        strokeLinecap="round"
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
        }}
      />
    </svg>
  );
}
