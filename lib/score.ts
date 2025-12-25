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

  // Уровни считаем по КОЛИЧЕСТВУ выборов каждой буквы (0..12),
  // согласно заданным диапазонам:
  // - Состязание (A): 0–3 низкая, 3–6 средняя, 6–12 высокая
  // - Сотрудничество (B): 0–4 низкая, 4–7 средняя, 8–12 высокая
  // - Компромисс (C): 0–5 низкая, 5–8 средняя, 8–12 высокая
  // - Уклонение (D): 0–3 низкая, 3–6 средняя, 6–12 высокая
  // - Подстройка (E): 0–3 низкая, 3–6 средняя, 6–12 высокая
  // В местах пересечения границ (например 3 и 6) приоритет у более высокого уровня:
  // 3 → средняя, 6 → высокая.
  const COUNT_THRESHOLDS: Record<Tag, { medium_from: number; strong_from: number }> = {
    A: { medium_from: 3, strong_from: 6 },
    B: { medium_from: 4, strong_from: 8 },
    C: { medium_from: 5, strong_from: 8 },
    D: { medium_from: 3, strong_from: 6 },
    E: { medium_from: 3, strong_from: 6 },
  };

  const levelForTagCount = (tag: Tag, count: number): ScoreRow["level"] => {
    const th = COUNT_THRESHOLDS[tag];
    if (count >= th.strong_from) return "сильная склонность";
    if (count >= th.medium_from) return "умеренная склонность";
    return "слабая склонность";
  };

  const ranked = tags
    .map((t) => ({
      tag: t,
      style: test.scoring.tag_to_style[t],
      count: counts[t],
      percent: percents[t],
      level: levelForTagCount(t, counts[t]),
    }))
    .sort((a, b) => b.percent - a.percent);

  return { total: chosenTags.length, counts, percents, ranked };
}
