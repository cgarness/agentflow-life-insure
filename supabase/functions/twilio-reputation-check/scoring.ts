export type ComputedReputation = {
  spam_score: number | null;
  spam_status: string;
  display_health: "Healthy" | "Watch" | "Spam likely" | "Evaluating" | "Insufficient Data";
  penalties: string[];
  metrics: {
    total_calls: number;
    block_rate_pct: number | null;
    short_call_pct: number | null;
    asr_pct: number | null;
    daily_dials: number | null;
    attestation_level: string | null;
  };
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Pull common metric shapes from Twilio Insights outbound report row (field names vary). */
export function extractReportMetrics(
  row: Record<string, unknown>,
  dailyCallCountFromDb: number | null,
  attestationFromDb: string | null,
): ComputedReputation["metrics"] {
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = num(row[k]);
      if (v !== null) return v;
    }
    return null;
  };

  const total =
    pick("total_calls", "total_call_attempts", "calls", "call_attempts") ?? 0;

  const blockRate =
    pick(
      "blocked_calls_percentage",
      "blocked_call_percentage",
      "block_rate",
      "blocked_calls_rate",
    );

  const shortCallPct =
    pick(
      "short_calls_percentage",
      "short_call_percentage",
      "pct_short_calls",
      "short_calls_pct",
    );

  const asrPct =
    pick(
      "answer_rate",
      "answer_rate_percentage",
      "call_answer_rate",
      "asr",
      "answer_seizure_ratio",
    );

  const attestation =
    (typeof row["attestation_level"] === "string" ? row["attestation_level"] : null) ??
    (typeof row["stir_shaken_attestation"] === "string" ? row["stir_shaken_attestation"] : null) ??
    attestationFromDb;

  return {
    total_calls: Math.round(total),
    block_rate_pct: blockRate,
    short_call_pct: shortCallPct,
    asr_pct: asrPct,
    daily_dials: dailyCallCountFromDb,
    attestation_level: attestation ? String(attestation).toUpperCase().slice(0, 1) : null,
  };
}

/**
 * Gemini-style 0–100 score with grace period (total calls < 20 → Evaluating, no score).
 * Missing Twilio fields skip that penalty block (do not assume worst case).
 */
export function computeReputation(
  metrics: ComputedReputation["metrics"],
): ComputedReputation {
  const penalties: string[] = [];
  const total = metrics.total_calls;

  if (total < 20) {
    return {
      spam_score: null,
      spam_status: "Evaluating",
      display_health: "Evaluating",
      penalties: ["Fewer than 20 calls in the Insights window — score withheld."],
      metrics,
    };
  }

  let score = 100;

  const br = metrics.block_rate_pct;
  if (br !== null) {
    if (br > 5) {
      score -= 40;
      penalties.push(`Block rate > 5% (${br.toFixed(1)}%)`);
    } else if (br >= 3) {
      score -= 20;
      penalties.push(`Block rate 3–5% (${br.toFixed(1)}%)`);
    }
  }

  const sc = metrics.short_call_pct;
  if (sc !== null) {
    if (sc > 15) {
      score -= 20;
      penalties.push(`Short calls > 15% (${sc.toFixed(1)}%)`);
    } else if (sc >= 7) {
      score -= 10;
      penalties.push(`Short calls 7–15% (${sc.toFixed(1)}%)`);
    }
  }

  const asr = metrics.asr_pct;
  if (asr !== null && asr < 40) {
    score -= 20;
    penalties.push(`Answer rate below 40% (${asr.toFixed(1)}%)`);
  }

  const dials = metrics.daily_dials;
  if (dials !== null && dials > 100) {
    score -= 15;
    penalties.push(`Daily dials on line > 100 (${dials})`);
  }

  const att = metrics.attestation_level;
  if (att && att !== "A") {
    score -= 30;
    penalties.push(`Attestation below A (${att})`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let spam_status: string;
  let display_health: ComputedReputation["display_health"];
  if (score >= 80) {
    spam_status = "Clean";
    display_health = "Healthy";
  } else if (score >= 60) {
    spam_status = "At Risk";
    display_health = "Watch";
  } else {
    spam_status = "Flagged";
    display_health = "Spam likely";
  }

  return { spam_score: score, spam_status, display_health, penalties, metrics };
}
