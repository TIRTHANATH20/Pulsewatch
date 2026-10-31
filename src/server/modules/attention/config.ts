import { getEnv } from "@/server/lib/env";

// Centralized threshold configuration for the attention engine — the
// single place severity cutoffs live, so `engine.ts` stays a pure
// function of (previous, quote, thresholds) with no env access of its
// own, which keeps it trivially unit-testable.
export interface AttentionThresholds {
  // Minimum absolute percentage move to classify CHANGED rather than
  // UNCHANGED.
  changedPct: number;
  // Minimum absolute percentage move to classify SIGNIFICANT rather than
  // CHANGED. Always >= changedPct (enforced by env.ts's refine check).
  significantPct: number;
}

export function getAttentionThresholds(): AttentionThresholds {
  const env = getEnv();
  return {
    changedPct: env.ATTENTION_CHANGED_PCT,
    significantPct: env.ATTENTION_SIGNIFICANT_PCT,
  };
}
