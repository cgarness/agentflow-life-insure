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
 * stub client in ./stubs. `window.__smsProbe` records timings for measure.mjs in two tiers:
 * RENDERED (the text is in the surface's DOM) and VISIBLE (a person could see it: non-zero size,
 * CSS-visible, at least half inside the viewport and every clipping ancestor, and not covered by
 * another element or a toast). Only a VISIBLE time is a user-visible latency.
 */

type Marks = Record<string, number>;
interface Visibility {
  width: number;
  height: number;
  cssVisible: boolean;
  visibleFraction: number;
  occludedBy: string | null;
  ok: boolean;
}
const probe = {
  text: "",
  region: "",
  marks: {} as Marks,
  /** Why the outgoing text, once rendered, was or was not visible (first observation). */
  firstRenderVisibility: null as Visibility | null,
  lastVisibility: null as Visibility | null,
  /** What the first visible change was: the outgoing text, or (base build) only the Send spinner. */
  firstChange: null as "text" | "spinner" | null,
  events: [] as { name: string; startTime: number; duration: number; processingStart: number; processingEnd: number }[],
  arm(text: string, region: string) {
    this.text = text;
    this.region = region;
    this.marks = {};
    this.firstRenderVisibility = null;
    this.lastVisibility = null;
    this.firstChange = null;
  },
  mark(name: string) {
    if (this.text && this.marks[name] === undefined) this.marks[name] = performance.now();
  },
};
(window as unknown as { __smsProbe: typeof probe }).__smsProbe = probe;

// Toasts still render but never intercept the next click on Send (the base build's success toast
// sits over the button at 1440 px). Their rectangles still count as covering a message below.
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

function describe(el: Element | null): string {
  if (!el) return "nothing";
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
}

/** What a person could see of `el` right now. `owner` is the element whose area counts as `el`. */
function visibility(el: Element, owner: Element = el): Visibility {
  const r = el.getBoundingClientRect();
  let clip = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const ar = a.getBoundingClientRect();
      clip = { l: Math.max(clip.l, ar.left), t: Math.max(clip.t, ar.top), r: Math.min(clip.r, ar.right), b: Math.min(clip.b, ar.bottom) };
    }
  }
  const left = Math.max(r.left, clip.l), top = Math.max(r.top, clip.t);
  const w = Math.max(0, Math.min(r.right, clip.r) - left);
  const h = Math.max(0, Math.min(r.bottom, clip.b) - top);
  const area = r.width * r.height;
  const visibleFraction = area > 0 ? (w * h) / area : 0;
  const cssVisible = typeof el.checkVisibility === "function"
    ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    : getComputedStyle(el).visibility !== "hidden";
  let occludedBy: string | null = null;
  if (w > 0 && h > 0) {
    const hit = document.elementFromPoint(left + w / 2, top + h / 2);
    // Hit testing skips `pointer-events: none` (a disabled Send button and its spinner), so the hit
    // falls through to an ancestor. That is not covering; toasts are checked by rectangle below.
    const fellThrough = !!hit && hit.contains(owner) && getComputedStyle(owner).pointerEvents === "none";
    if (!hit || !(owner.contains(hit) || fellThrough)) occludedBy = describe(hit);
    for (const toast of document.querySelectorAll("[data-sonner-toast]")) {
      const tr = toast.getBoundingClientRect();
      if (tr.left < left + w && tr.right > left && tr.top < top + h && tr.bottom > top) occludedBy = "toast";
    }
  }
  const ok = r.width > 0 && r.height > 0 && cssVisible && visibleFraction >= 0.5 && occludedBy === null;
  return { width: Math.round(r.width), height: Math.round(r.height), cssVisible, visibleFraction: +visibleFraction.toFixed(2), occludedBy, ok };
}

/** Elements in the surface whose own text holds the probe text (one bubble per send). */
function textElements(region: Element, text: string): Element[] {
  const found: Element[] = [];
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node.nodeValue ?? "").includes(text) && node.parentElement) found.push(node.parentElement);
  }
  return found;
}

const bubbleOf = (el: Element) => el.closest(".rounded-2xl") ?? el;
const isPending = (el: Element) =>
  !!el.closest('[data-testid="pending-sms"]') || !!el.closest(".flex.flex-col.w-full")?.querySelector('[data-testid="pending-sms-status"]');

// Only a real click on Send starts a measurement (never Enter, a forced click or DOM insertion).
document.addEventListener("click", (event) => {
  const onSend = (event.target as Element | null)?.closest?.('button[title="Send SMS"]');
  if (onSend && probe.text && probe.marks.click === undefined) probe.marks.click = event.timeStamp;
}, true);

let frameWatch = 0;
function check() {
  const m = probe.marks;
  if (!probe.text || m.click === undefined) return;
  const now = performance.now();
  const region = document.querySelector(probe.region);
  const matches = region ? textElements(region, probe.text) : [];
  const send = document.querySelector('button[title="Send SMS"]');
  const spinner = send?.querySelector(".animate-spin");
  const spinnerVisible = !!spinner && !!send && visibility(spinner, send).ok;
  if (matches.length && m.outgoingRendered === undefined) {
    m.outgoingRendered = now;
    afterPaint("outgoingRenderedPaint");
    probe.firstRenderVisibility = visibility(matches[0], bubbleOf(matches[0]));
  }
  const visible = matches.find((el) => {
    const v = visibility(el, bubbleOf(el));
    probe.lastVisibility = v;
    return v.ok;
  });
  if (m.firstChangeVisible === undefined && (visible || spinnerVisible)) {
    m.firstChangeVisible = now;
    probe.firstChange = visible ? "text" : "spinner";
    afterPaint("firstChangeVisiblePaint");
  }
  if (visible && m.outgoingVisible === undefined) { m.outgoingVisible = now; afterPaint("outgoingVisiblePaint"); }
  const pendingLeft = document.querySelector('[data-testid="pending-sms"], [data-testid="pending-sms-status"]');
  if (m.receipt !== undefined && !pendingLeft) {
    const saved = matches.filter((el) => !isPending(el));
    if (saved.length && m.savedRendered === undefined) { m.savedRendered = now; afterPaint("savedRenderedPaint"); }
    if (m.savedVisible === undefined && saved.some((el) => visibility(el, bubbleOf(el)).ok)) { m.savedVisible = now; afterPaint("savedVisiblePaint"); }
  }
  // Scrolling changes visibility without a DOM mutation: keep checking each frame while the text
  // is rendered but not yet visible (bounded; the driver reports a timeout as not visible).
  const waiting = (m.outgoingRendered !== undefined && m.outgoingVisible === undefined) ||
    (m.savedRendered !== undefined && m.savedVisible === undefined);
  if (waiting && !frameWatch) frameWatch = requestAnimationFrame(() => { frameWatch = 0; check(); });
}
new MutationObserver(check).observe(document.documentElement, {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled"],
});

try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as PerformanceEventTiming[]) {
      if (e.name === "click") probe.events.push({ name: e.name, startTime: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd });
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
