import type { ForcedPairTestV1, Tag } from "@/lib/testTypes";

export type ScoreRow = {
  tag: Tag;
  style: string;
  count: number;
  percent: number;
  level: "сильная склонность" | "умеренная склонность" | "слабая склонность";
};

export type ScoreResult = {
  total: number;
  counts: Record<Tag, number>;
  percents: Record<Tag, number>;
  ranked: ScoreRow[];
};

export function scoreForcedPair(test: ForcedPairTestV1, chosenTags: Tag[]): ScoreResult {
  const tags = test.scoring.tags;
  const counts = Object.fromEntries(tags.map((t) => [t, 0])) as Record<Tag, number>;

  for (const t of chosenTags) {
    if (counts[t] === undefined) continue;
    counts[t] += 1;
  }

  const total = chosenTags.length || 1;
  const percents = Object.fromEntries(
    tags.map((t) => [t, Math.round((counts[t] / total) * 100)])
  ) as Record<Tag, number>;

  const { strong_gte, weak_lte } = test.scoring.thresholds_percent;

  const levelFor = (p: number): ScoreRow["level"] => {
    if (p >= strong_gte) return "сильная склонность";
    if (p <= weak_lte) return "слабая склонность";
    return "умеренная склонность";
  };

  const ranked = tags
    .map((t) => ({
      tag: t,
      style: test.scoring.tag_to_style[t],
      count: counts[t],
      percent: percents[t],
      level: levelFor(percents[t]),
    }))
    .sort((a, b) => b.percent - a.percent);

  return { total: chosenTags.length, counts, percents, ranked };
}
