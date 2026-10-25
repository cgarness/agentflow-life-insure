// Work that continues after the HTTP response (EdgeRuntime.waitUntil). It only ever starts AFTER the work it
// serves is durably queued, so a terminated isolate loses nothing: the job stays queued and its lease expires.
import { sanitizeError } from "../errors.ts";

export type Background = (work: Promise<unknown>, label: string) => void;

export const background: Background = (work, label) => {
  const guarded = work.catch((e) => console.error(`${label}: background work failed: ${sanitizeError(e)}`));
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  try {
    runtime?.waitUntil?.(guarded);
  } catch (e) {
    console.warn(`${label}: EdgeRuntime.waitUntil unavailable: ${sanitizeError(e)}`);
  }
};
