import React from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { CalendarProvider } from "@/contexts/CalendarContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import Conversations from "@/pages/Conversations";
import FullScreenContactView from "@/components/contacts/FullScreenContactView";
import { FIXTURE } from "./stubs/supabase";

/**
 * Synthetic SMS responsiveness fixture. `?surface=conversations|contact`. Mounts the real page or
 * contact record, as App does (the candidate's authority bridge when the build has one), over the
 * stub client in ./stubs. `window.__smsProbe` records DOM-observed timings for measure.mjs.
 */

type Marks = Record<string, number>;
const probe = {
  text: "",
  region: "",
  marks: {} as Marks,
  events: [] as { startTime: number; duration: number; processingStart: number; processingEnd: number }[],
  arm(text: string, region: string) {
    this.text = text;
    this.region = region;
    this.marks = {};
  },
  mark(name: string) {
    if (this.text && this.marks[name] === undefined) this.marks[name] = performance.now();
  },
};
(window as unknown as { __smsProbe: typeof probe }).__smsProbe = probe;

// Toasts still render, but never intercept the next click on Send (the base build's success toast
// sits over the button at 1440 px); the driver must act identically on both builds.
const style = document.createElement("style");
style.textContent = "[data-sonner-toaster], [data-sonner-toast] { pointer-events: none !important; }";
document.head.appendChild(style);

/** The first moment after the next frame was presented: rAF, then a posted task. */
function afterPaint(name: string) {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (probe.marks[name] === undefined) probe.marks[name] = performance.now();
    };
    channel.port2.postMessage(0);
  });
}

// The send input: a click on Send, or Enter in the SMS composer (used where Send is covered).
const markInput = (event: Event) => {
  if (probe.text && probe.marks.click === undefined) probe.marks.click = event.timeStamp;
};
document.addEventListener("click", (event) => {
  if ((event.target as Element | null)?.closest?.('button[title="Send SMS"]')) markInput(event);
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.target as Element | null)?.matches?.('input[placeholder="Type SMS message…"]')) markInput(event);
}, true);

function check() {
  const m = probe.marks;
  if (!probe.text || m.click === undefined) return;
  const now = performance.now();
  const region = document.querySelector(probe.region);
  const shown = !!region && (region.textContent ?? "").includes(probe.text);
  const spinner = !!document.querySelector('button[title="Send SMS"] .animate-spin');
  if (m.firstChange === undefined && (shown || spinner)) { m.firstChange = now; afterPaint("firstChangePaint"); }
  if (m.outgoing === undefined && shown) { m.outgoing = now; afterPaint("outgoingPaint"); }
  const pending = document.querySelector('[data-testid="pending-sms"], [data-testid="pending-sms-status"]');
  if (m.receipt !== undefined && m.saved === undefined && shown && !pending) { m.saved = now; afterPaint("savedPaint"); }
}
new MutationObserver(check).observe(document.documentElement, {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled"],
});

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceEventTiming[]) {
      if (e.name === "click" || e.name === "keydown") probe.events.push({ startTime: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd });
    }
  }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
} catch {
  // Event Timing unavailable: the frame probe above still measures.
}

const bridges = import.meta.glob("@/components/messaging/PendingSmsAuthorityBridge.tsx", { eager: true }) as Record<string, { PendingSmsAuthorityBridge: React.FC }>;
const Bridge = Object.values(bridges)[0]?.PendingSmsAuthorityBridge ?? (() => null);

const CONTACT = {
  id: FIXTURE.contact, firstName: "Jordan", lastName: "Rivera", phone: "5125550123", email: "jordan@example.test", state: "TX",
  status: "New", leadSource: "Referral", assignedAgentId: FIXTURE.actor, userId: FIXTURE.actor,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

const surface = new URLSearchParams(location.search).get("surface") === "contact" ? "contact" : "conversations";
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrandingProvider>
        <CalendarProvider>
          <SidebarProvider>
            <Sonner />
            <Bridge />
            <MemoryRouter>
              <div className="h-screen flex flex-col" data-surface={surface}>
                {surface === "contact" ? (
                  <FullScreenContactView contact={CONTACT} type="lead" onClose={() => {}} onUpdate={async () => {}} onDelete={async () => {}} />
                ) : (
                  <Conversations />
                )}
              </div>
            </MemoryRouter>
          </SidebarProvider>
        </CalendarProvider>
      </BrandingProvider>
    </TooltipProvider>
  </QueryClientProvider>,
);
