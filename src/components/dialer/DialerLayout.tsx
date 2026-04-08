import React from "react";
import { useDialer } from "@/contexts/DialerContext";
import { DialerHeader } from "@/components/dialer/DialerHeader";
import { DialerContactSidebar } from "@/components/dialer/DialerContactSidebar";
import { DialerOutcomePanel } from "@/components/dialer/DialerOutcomePanel";
import { DialerModalsContainer } from "@/components/dialer/DialerModalsContainer";

export const DialerLayout: React.FC = () => {
  const { lockMode, campaignType } = useDialer();

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] lg:h-[calc(100vh-88px)] -mt-4 lg:-mt-6 -mb-4 lg:-mb-6 overflow-hidden bg-background text-foreground">
      
      {/* ── CAMPAIGN TYPE STRIPE ── */}
      {lockMode && (() => {
        const t = campaignType.toUpperCase();
        const gradient = t === "TEAM"
          ? "linear-gradient(to right, #6366f1, #8b5cf6, #a855f7)"
          : "linear-gradient(to right, #f59e0b, #ef4444, #f59e0b)";
        return (
          <div
            style={{ height: "3px", background: gradient, flexShrink: 0 }}
            aria-hidden="true"
          />
        );
      })()}

      <DialerHeader />

      <main className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 h-full gap-0">
          {/* LEFT: Contact & History (4 cols) */}
          <div className="lg:col-span-4 border-r flex flex-col h-full bg-muted/5">
            <DialerContactSidebar />
          </div>

          {/* RIGHT: Dialer Actions, Script, Queue (8 cols) */}
          <div className="lg:col-span-8 flex flex-col h-full bg-background relative">
            <DialerOutcomePanel />
          </div>
        </div>
      </main>

      <DialerModalsContainer />
    </div>
  );
};
