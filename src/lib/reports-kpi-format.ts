// Single rounding and tile presentation for v3 KPI envelopes (D6 §4.3, plan §2.5). The browser computes no KPI:
// every figure is rounded exactly once from the server's exact numerator and denominator.
import { formatElapsed, formatPremium } from "@/lib/reports-format";
import type { KpiDefinition } from "@/lib/reports-kpi-registry";
import type { KpiEnvelope, ReasonCode } from "@/lib/reports-v3-schemas";
import { REASON_KIND } from "@/lib/reports-v3-schemas";
import {
  CHIP_IN_PROGRESS, CHIP_PARTIAL, CUE_NOT_ENOUGH_DATA, MATURE_ONLY_LABEL, REASON_NOTICES, SHORT_CUES,
  basedOnLine, fillNotice, fullyMatureOn, pendingLine,
} from "@/lib/reports-v3-text";

const toBig = (n: number | bigint) => (typeof n === "bigint" ? n : BigInt(n));

/** floor((2·n·10^k + d) / (2·d)) / 10^k in integer arithmetic; a string with exactly k decimals. */
export function roundHalfUp(numerator: number | bigint, denominator: number | bigint, k: number): string {
  const n = toBig(numerator), d = toBig(denominator);
  if (d <= 0n) throw new RangeError("roundHalfUp needs a positive denominator");
  const scale = 10n ** BigInt(k);
  const twice = 2n * n * scale + d;
  const q = twice >= 0n ? twice / (2n * d) : -((-twice + 2n * d - 1n) / (2n * d));
  const negative = q < 0n;
  const abs = negative ? -q : q;
  const whole = abs / scale, frac = abs % scale;
  const text = k === 0 ? `${whole}` : `${whole}.${frac.toString().padStart(k, "0")}`;
  return negative ? `-${text}` : text;
}

/** A value with at most 6 decimal places as an exact count of millionths (no float drift). */
export function toMillionths(value: number): bigint {
  const [whole, frac = ""] = Math.abs(value).toFixed(6).split(".");
  const m = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0").slice(0, 6));
  return value < 0 ? -m : m;
}

/** Dollars with at most two decimals as an exact count of cents. */
export function toCents(dollars: number): bigint {
  const [whole, frac = ""] = Math.abs(dollars).toFixed(2).split(".");
  const c = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return dollars < 0 ? -c : c;
}

const dropZero = (s: string) => (s.endsWith(".0") ? s.slice(0, -2) : s);

/** The screen value of an envelope with a non-null value, at the registry's display precision. */
export function displayValue(def: KpiDefinition, env: KpiEnvelope): string {
  const n = env.numerator, d = env.denominator;
  switch (def.display) {
    case "premium":
      // Money is dollars with exact cents. KPI 1 is the exact sum; KPI 4 is its exact numerator over the known-premium
      // count, rounded once to cents.
      if (def.kind === "ratio") return formatPremium(Number(roundHalfUp(toCents(n ?? 0), d ?? 1, 0)) / 100);
      return formatPremium(Number(toCents(env.value ?? 0)) / 100);
    case "integer":
      return Math.round(env.value ?? 0).toLocaleString("en-US");
    case "1dp":
      if (def.unit === "percent") return `${roundHalfUp((n ?? 0) * 100, d ?? 1, 1)}%`;
      return roundHalfUp(n ?? 0, d ?? 1, 1);
    case "1dp_drop_zero":
      return dropZero(roundHalfUp(toMillionths(env.value ?? 0), 1_000_000n, 1));
    case "elapsed":
      return formatElapsed(env.value ?? 0);
  }
}

/** The CSV value of an envelope with a non-null value, at the registry's CSV precision. */
export function csvValue(def: KpiDefinition, env: KpiEnvelope): string {
  const n = env.numerator ?? 0, d = env.denominator ?? 1;
  switch (def.csv) {
    case "integer": return String(Math.round(env.value ?? 0));
    case "integer_seconds": return String(Math.round(env.value ?? 0));
    case "2dp":
      if (def.unit === "currency") return def.kind === "ratio" ? roundHalfUp(toCents(n), d * 100, 2) : roundHalfUp(toCents(env.value ?? 0), 100, 2);
      return roundHalfUp(n, d, 2);
    case "1dp":
      if (def.unit === "percent") return roundHalfUp(n * 100, d, 1);
      return roundHalfUp(toMillionths(env.value ?? 0), 1_000_000n, 1);
  }
}

const isCoverage = (code: ReasonCode) => REASON_KIND[code] === "coverage";

export interface TileView {
  /** The value, or "—" when unavailable. */
  text: string;
  /** Plain-text cue under an unavailable value ("Not tracked yet", "Not enough data"); null otherwise. */
  cue: string | null;
  chips: ("partial" | "in_progress")[];
  /** Screen-reader text: the value plus every state in words (status is never colour alone). */
  srText: string;
}

export function tileView(def: KpiDefinition, env: KpiEnvelope): TileView {
  const inProgress = env.maturity?.state === "in_progress";
  if (env.status === "unavailable") {
    const reason = env.reason as ReasonCode;
    const cue = isCoverage(reason) ? CUE_NOT_ENOUGH_DATA : SHORT_CUES[reason];
    const chips: TileView["chips"] = inProgress ? ["in_progress"] : [];
    return { text: "—", cue, chips, srText: `${def.label}: not available. ${notice(env, reason)}` };
  }
  const text = displayValue(def, env);
  const chips: TileView["chips"] = [];
  if (env.status === "partial") chips.push("partial");
  if (inProgress) chips.push("in_progress");
  const words = chips.map(c => (c === "partial" ? CHIP_PARTIAL : CHIP_IN_PROGRESS)).join(", ");
  return { text, cue: null, chips, srText: `${def.label}: ${text}${words ? ` (${words})` : ""}` };
}

function notice(env: KpiEnvelope, code: ReasonCode): string {
  const cov = env.coverage;
  const capture = (env.detail as { capture?: { outcomes_started_on?: string | null } } | null)?.capture;
  if (code === "history_incomplete" && cov && cov.unassessable === 0) {
    const n = (env.detail as { history?: { numberless_unresolved_calls?: number } } | null)?.history?.numberless_unresolved_calls ?? 0;
    return `${n} unlinked calls have no recorded number and could not be ruled out`;
  }
  return fillNotice(REASON_NOTICES[code], {
    n: cov?.reasons?.[code] ?? 0, a: cov?.assessable ?? 0, e: cov?.eligible ?? 0, date: capture?.outcomes_started_on ?? null,
  });
}

/** The chip disclosure lines (also used by How it's calculated → Coverage in this report). */
export function disclosureLines(def: KpiDefinition, env: KpiEnvelope): string[] {
  const lines: string[] = [];
  const codes = new Set<ReasonCode>();
  if (env.reason) codes.add(env.reason as ReasonCode);
  for (const code of Object.keys(env.coverage?.reasons ?? {})) codes.add(code as ReasonCode);
  for (const code of codes) lines.push(notice(env, code));
  const cov = env.coverage;
  if (cov && cov.unassessable > 0 && !codes.has("history_incomplete")) lines.push(basedOnLine(cov.assessable, cov.eligible));
  if (env.value !== null && env.numerator !== null && env.denominator !== null && def.kind !== "count" && def.kind !== "sum") {
    lines.push(`${env.numerator.toLocaleString("en-US")} of ${env.denominator.toLocaleString("en-US")}${env.maturity ? ", observed to date" : ""}`);
  }
  const m = env.maturity;
  if (m && m.state === "in_progress") {
    lines.push(pendingLine(m.pending));
    if (m.fully_mature_on) lines.push(fullyMatureOn(m.fully_mature_on));
    lines.push(`${MATURE_ONLY_LABEL}: ${m.mature_successes} of ${m.mature_members}`);
  }
  return [...new Set(lines.filter(Boolean))];
}
