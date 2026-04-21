import React from "react";
import { motion } from "framer-motion";
import { Radio, Shield } from "lucide-react";

type Props = {
  activeLineCount: number;
};

/**
 * Always-on “AI shield” visual — decorative watch state for the Number Reputation tab.
 */
export const ReputationAiScanner: React.FC<Props> = ({ activeLineCount }) => {
  return (
    <div className="relative overflow-hidden rounded-xl border border-cyan-500/25 bg-[#040814] text-cyan-50 shadow-[0_0_48px_-8px_rgba(34,211,238,0.35)]">
      {/* Animated grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.22] animate-reputation-grid motion-reduce:animate-none"
        style={{
          backgroundImage: `linear-gradient(rgba(34,211,238,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.2) 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
          backgroundPosition: "0 0",
        }}
      />

      {/* Slow radar sweep */}
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-30 motion-reduce:hidden"
        style={{
          background: "conic-gradient(from 0deg, transparent 0deg, rgba(34,211,238,0.35) 45deg, transparent 90deg)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
      />

      {/* Vertical scan beam */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
        <div className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-cyan-400/25 to-transparent animate-reputation-scan-sweep" />
      </div>

      {/* HUD frame */}
      <div className="relative z-[1] flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-dashed border-cyan-400/50"
              animate={{ rotate: -360 }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-1 rounded-full border border-fuchsia-500/40"
              animate={{ scale: [1, 1.06, 1], opacity: [0.5, 0.85, 0.5] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
            <Shield className="relative h-6 w-6 text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-cyan-400/90 sm:text-xs">
              AgentFlow // Reputation shield
            </p>
            <h4 className="mt-1 text-lg font-semibold tracking-tight text-white sm:text-xl">AI line monitor</h4>
            <p className="mt-1 max-w-md text-xs text-cyan-100/70 sm:text-sm">
              Continuous watch on your agency&apos;s caller IDs. Run a check on any row to refresh attestation and
              reputation signals from Twilio.
            </p>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center md:flex-col md:items-end">
          <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-black/40 px-3 py-2 font-mono text-xs text-cyan-200/90">
            <Radio className="h-3.5 w-3.5 text-emerald-400 animate-reputation-pulse-dot" />
            <span>LIVE NEURAL FILTER</span>
          </div>
          <div className="rounded-lg border border-fuchsia-500/25 bg-black/35 px-4 py-2 text-right">
            <p className="font-mono text-[10px] uppercase tracking-widest text-fuchsia-300/80">Protected lines</p>
            <p className="text-2xl font-bold tabular-nums text-white">{activeLineCount}</p>
          </div>
        </div>
      </div>

      {/* Bottom ticker */}
      <div className="relative z-[1] border-t border-cyan-500/15 bg-black/50 px-3 py-2">
        <div className="flex overflow-hidden font-mono text-[10px] text-cyan-300/70 sm:text-xs">
          <motion.div
            className="flex shrink-0 gap-8 whitespace-nowrap"
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 22, repeat: Infinity, ease: "linear" }}
          >
            {[0, 1].map((dup) => (
              <span key={dup} className="inline-flex gap-8">
                <span>STIR/SHAKEN attestation · Voice integrity alignment · Carrier block heuristics ·</span>
                <span>Spam label watch · Answer-rate drift · Policy guard ·</span>
              </span>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
};
