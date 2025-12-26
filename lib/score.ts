import type { ForcedPairTestV1, PairSplitTestV1, Tag, MotivationFactor } from "@/lib/testTypes";

export type ScoreRow = {
  tag: string;
  style: string;
  count: number;
  percent: number;
  level: string;
};

export type ScoreResult = {
  kind: "forced_pair_v1" | "pair_sum5_v1";
  total: number;
  counts: Record<string, number>;
  percents: Record<string, number>;
  ranked: ScoreRow[];
  meta?: Record<string, any>;
};

// ===================== Negotiation test (forced pair) =====================

export function scoreForcedPair(test: ForcedPairTestV1, chosenTags: Tag[]): ScoreResult {
  const tags = test.scoring.tags;
  const counts = Object.fromEntries(tags.map((t) => [t, 0])) as Record<Tag, number>;

  for (const t of chosenTags) {
    if (counts[t] === undefined) continue;
    counts[t] += 1;
  }

  const total = chosenTags.length || 1;
  const percents = Object.fromEntries(tags.map((t) => [t, Math.round((counts[t] / total) * 100)])) as Record<Tag, number>;

  // Levels by *counts* (0..12) — per your custom ranges.
  // Boundary rule: shared boundary belongs to higher level (e.g. 3 => medium, 6 => high).
  const COUNT_THRESHOLDS: Record<Tag, { medium_from: number; strong_from: number }> = {
    A: { medium_from: 3, strong_from: 6 },
    B: { medium_from: 4, strong_from: 8 },
    C: { medium_from: 5, strong_from: 8 },
    D: { medium_from: 3, strong_from: 6 },
    E: { medium_from: 3, strong_from: 6 },
  };

  const levelForTagCount = (tag: Tag, count: number): string => {
    const th = COUNT_THRESHOLDS[tag];
    if (count >= th.strong_from) return "сильная склонность";
    if (count >= th.medium_from) return "умеренная склонность";
    return "слабая склонность";
  };

  const ranked: ScoreRow[] = tags
    .map((t) => ({
      tag: t,
      style: test.scoring.tag_to_style[t],
      count: counts[t],
      percent: percents[t],
      level: levelForTagCount(t, counts[t]),
    }))
    .sort((a, b) => b.percent - a.percent);

  return {
    kind: "forced_pair_v1",
    total: chosenTags.length,
    counts: counts as any,
    percents: percents as any,
    ranked,
  };
}

// ===================== Motivation cards (pair split 0..5 per pair) =====================

/**
 * answersLeftPoints[i] — сколько баллов (0..maxPoints) отдано ЛЕВОМУ утверждению i-й пары.
 * Правому автоматически начисляется maxPoints - left.
 */
export function scorePairSplit(test: PairSplitTestV1, answersLeftPoints: number[]): ScoreResult {
  const factors = test.scoring.factors;
  const counts: Record<MotivationFactor, number> = Object.fromEntries(factors.map((f) => [f, 0])) as any;
  const maxByFactor: Record<MotivationFactor, number> = Object.fromEntries(factors.map((f) => [f, 0])) as any;

  for (let i = 0; i < test.questions.length; i++) {
    const q = test.questions[i];
    const max = q.maxPoints ?? 5;
    const left = Math.max(0, Math.min(max, Math.round(answersLeftPoints[i] ?? 0)));
    const right = max - left;

    counts[q.left.factor] = (counts[q.left.factor] ?? 0) + left;
    counts[q.right.factor] = (counts[q.right.factor] ?? 0) + right;

    maxByFactor[q.left.factor] = (maxByFactor[q.left.factor] ?? 0) + max;
    maxByFactor[q.right.factor] = (maxByFactor[q.right.factor] ?? 0) + max;
  }

  // Normalize each factor to 0..35 so levels are comparable even if factor frequencies differ.
  const toNorm35 = (factor: MotivationFactor, raw: number) => {
    const max = maxByFactor[factor] || 1;
    return Math.round((raw / max) * 35);
  };

  const th = test.scoring.thresholds_norm35 ?? { low_max: 12, mid_max: 23 };
  const levelForNorm35 = (n: number) => {
    if (n <= th.low_max) return "низкая выраженность";
    if (n <= th.mid_max) return "средняя выраженность";
    return "высокая выраженность";
  };

  const percents: Record<MotivationFactor, number> = Object.fromEntries(
    factors.map((f) => {
      const max = maxByFactor[f] || 1;
      return [f, Math.round((counts[f] / max) * 100)];
    })
  ) as any;

  const ranked: ScoreRow[] = factors
    .map((f) => {
      const norm35 = toNorm35(f, counts[f]);
      return {
        tag: f,
        style: test.scoring.factor_to_name[f],
        count: counts[f],
        percent: percents[f],
        level: levelForNorm35(norm35),
      };
    })
    .sort((a, b) => b.percent - a.percent);

  const meta: Record<string, any> = {
    maxByFactor,
    norm35ByFactor: Object.fromEntries(factors.map((f) => [f, toNorm35(f, counts[f])])),
  };

  // Group totals (optional)
  if (test.scoring.groups?.hygiene?.length || test.scoring.groups?.motivators?.length) {
    const hygiene = test.scoring.groups?.hygiene ?? [];
    const motivators = test.scoring.groups?.motivators ?? [];
    const sum = (arr: MotivationFactor[]) => arr.reduce((acc, f) => acc + (counts[f] ?? 0), 0);
    const sumMax = (arr: MotivationFactor[]) => arr.reduce((acc, f) => acc + (maxByFactor[f] ?? 0), 0);
    meta.groups = {
      hygiene: { sum: sum(hygiene), max: sumMax(hygiene) },
      motivators: { sum: sum(motivators), max: sumMax(motivators) },
    };
  }

  return {
    kind: "pair_sum5_v1",
    total: test.questions.reduce((acc, q) => acc + (q.maxPoints ?? 5), 0),
    counts: counts as any,
    percents: percents as any,
    ranked,
    meta,
  };
}
