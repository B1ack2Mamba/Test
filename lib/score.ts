import type {
  ForcedPairTestV1,
  PairSplitTestV1,
  ColorTypesTestV1,
  USKTestV1,
  USKScale,
  Tag,
  MotivationFactor,
  ABC,
  PF16TestV1,
  PF16Factor,
} from "@/lib/testTypes";
import { pf16PickNormGroup, pf16NormGroupLabel, pf16RawToSten, type Pf16Gender } from "@/lib/pf16Norms";

export type ScoreRow = {
  tag: string;
  style: string;
  count: number;
  percent: number;
  level: string;
};

export type ScoreResult = {
  kind: "forced_pair_v1" | "pair_sum5_v1" | "color_types_v1" | "usk_v1" | "16pf_v1";
  title?: string;
  summary?: string;
  total: number;
  counts: Record<string, number>;
  percents: Record<string, number>;
  ranked: ScoreRow[];
  meta?: Record<string, any>;
};

// ===================== Negotiation test (forced pair) =====================

export function scoreForcedPair(test: ForcedPairTestV1, chosenTags: Tag[]): ScoreResult {
  // Display/order requirement: A → B → C → D → E (not by priority)
  const baseTags = test.scoring.tags;
  const preferred: Tag[] = ["A", "B", "C", "D", "E"];
  const tags: Tag[] = preferred.filter((t) => baseTags.includes(t));
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
    }));


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
  // Preferred display order for the classic 8-factor motivation cards:
  // A, D, I, B, C, E, F, H (as in the original key/table).
  const baseFactors = test.scoring.factors as MotivationFactor[];
  const preferred: MotivationFactor[] = ["A", "D", "I", "B", "C", "E", "F", "H"];

  const hasAllPreferred = preferred.every((f) => baseFactors.includes(f));
  const factors: MotivationFactor[] = hasAllPreferred
    ? [...preferred, ...baseFactors.filter((f) => !preferred.includes(f))]
    : baseFactors;

  const counts: Record<MotivationFactor, number> = Object.fromEntries(
    factors.map((f) => [f, 0] as const)
  ) as Record<MotivationFactor, number>;

  const maxByFactor: Record<MotivationFactor, number> = Object.fromEntries(
    factors.map((f) => [f, 0] as const)
  ) as Record<MotivationFactor, number>;

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
    ;

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

// ===================== Color types / Structogram (Green/Red/Blue) =====================

export type ColorTypesAnswers = {
  q1: ABC;
  q2: ABC;
  q3: ABC[]; // ranked (most -> least)
  q4: ABC[];
  q5: number[]; // picked 3 of 1..6
  q6: number[];
};

function normKey(parts: (string | number)[], sep = "/") {
  return parts.map((x) => String(x).trim()).filter(Boolean).join(sep);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function clampInt(n: any, min: number, max: number) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

export function scoreColorTypes(test: ColorTypesTestV1, answers: ColorTypesAnswers): ScoreResult {
  const base = Number(test.scoring?.base ?? 12);
  if (!Number.isFinite(base)) throw new Error("Bad base");

  const m = test.scoring.matrix;
  if (!m) throw new Error("Missing matrix");

  const safeABC = (v: any): ABC => (v === "A" || v === "B" || v === "C" ? v : "A");

  const q1 = safeABC((answers as any)?.q1);
  const q2 = safeABC((answers as any)?.q2);

  const q3arr = Array.isArray((answers as any)?.q3) ? ((answers as any).q3 as any[]).map(safeABC) : [];
  const q4arr = Array.isArray((answers as any)?.q4) ? ((answers as any).q4 as any[]).map(safeABC) : [];

  const q5arr = Array.isArray((answers as any)?.q5) ? ((answers as any).q5 as any[]).map((x) => clampInt(x, 1, 6)) : [];
  const q6arr = Array.isArray((answers as any)?.q6) ? ((answers as any).q6 as any[]).map((x) => clampInt(x, 1, 6)) : [];

  if (q3arr.length !== 3 || uniq(q3arr).length !== 3) throw new Error("Q3 must be a ranking of A/B/C");
  if (q4arr.length !== 3 || uniq(q4arr).length !== 3) throw new Error("Q4 must be a ranking of A/B/C");
  if (q5arr.length !== 3 || uniq(q5arr).length !== 3) throw new Error("Q5 must pick 3 distinct options");
  if (q6arr.length !== 3 || uniq(q6arr).length !== 3) throw new Error("Q6 must pick 3 distinct options");

  const k3 = normKey(q3arr, "/");
  const k4 = normKey(q4arr, "/");
  const k5 = normKey([...q5arr].sort((a, b) => a - b), "/");
  const k6 = normKey([...q6arr].sort((a, b) => a - b), "/");

  const get = (obj: Record<string, { a: number; b: number }>, key: string) => obj[key] ?? obj["default"] ?? { a: 0, b: 0 };

  const c1 = m.q1[q1] ?? { a: 0, b: 0 };
  const c2 = m.q2[q2] ?? { a: 0, b: 0 };
  const c3 = get(m.q3, k3);
  const c4 = get(m.q4, k4);
  const c5 = get(m.q5, k5);
  const c6 = get(m.q6, k6);

  const a = (c1.a ?? 0) + (c2.a ?? 0) + (c3.a ?? 0) + (c4.a ?? 0) + (c5.a ?? 0) + (c6.a ?? 0);
  const b = (c1.b ?? 0) + (c2.b ?? 0) + (c3.b ?? 0) + (c4.b ?? 0) + (c5.b ?? 0) + (c6.b ?? 0);

  // Colors are derived from two axes (a and b).
  // Verified against the reference case: choosing all first answers must yield
  // Зеленый=15, Красный=12, Синий=9 (with base=12).
  const green = base + a;
  const red = base - a + b;
  const blue = base - b;

  const total = green + red + blue;
  const denom = total || 1;

  const labels = {
    green: test.scoring?.labels?.green ?? "Зелёный",
    red: test.scoring?.labels?.red ?? "Красный",
    blue: test.scoring?.labels?.blue ?? "Синий",
  };

  const percents = {
    green: Math.round((green / denom) * 100),
    red: Math.round((red / denom) * 100),
    blue: Math.round((blue / denom) * 100),
  };

  const levelForPercent = (p: number) => (p >= 40 ? "высокая выраженность" : p >= 30 ? "средняя выраженность" : "низкая выраженность");

  const ranked: ScoreRow[] = [
    { tag: "green", style: labels.green, count: green, percent: percents.green, level: levelForPercent(percents.green) },
    { tag: "red", style: labels.red, count: red, percent: percents.red, level: levelForPercent(percents.red) },
    { tag: "blue", style: labels.blue, count: blue, percent: percents.blue, level: levelForPercent(percents.blue) },
  ];

  return {
    kind: "color_types_v1",
    total,
    counts: { green, red, blue },
    percents,
    ranked,
    meta: {
      base,
      a,
      b,
      contributions: { q1: c1, q2: c2, q3: c3, q4: c4, q5: c5, q6: c6 },
      keys: { q3: k3, q4: k4, q5: k5, q6: k6 },
    },
  };
}

// ===================== USK (Уровень субъективного контроля) =====================

function toSten(ranges: { min: number; max: number; sten: number }[], raw: number) {
  for (const r of ranges) {
    if (raw >= r.min && raw <= r.max) return r.sten;
  }
  // Fallback: clamp to 1..10 if out of ranges.
  if (!ranges?.length) return 5;
  const min = Math.min(...ranges.map((x) => x.min));
  const max = Math.max(...ranges.map((x) => x.max));
  if (raw < min) return 1;
  if (raw > max) return 10;
  return 5;
}

export function scoreUSK(test: USKTestV1, answers: number[]): ScoreResult {
  const scales = test.scoring.scales;
  const rawByScale: Record<USKScale, number> = Object.fromEntries(scales.map((s) => [s, 0])) as any;
  const stenByScale: Record<USKScale, number> = Object.fromEntries(scales.map((s) => [s, 5])) as any;
  const percentByScale: Record<USKScale, number> = Object.fromEntries(scales.map((s) => [s, 50])) as any;

  // Normalize answers to -3..3. Missing -> 0.
  const vals = Array.from({ length: test.questions.length }, (_, i) => clampInt(answers?.[i] ?? 0, -3, 3));

  const valAt = (idx1: number) => vals[idx1 - 1] ?? 0; // 1-based to 0-based

  for (const s of scales) {
    const key = test.scoring.keys[s];
    let raw = 0;
    for (const i of key.plus ?? []) raw += valAt(i);
    for (const i of key.minus ?? []) raw -= valAt(i);
    rawByScale[s] = raw;

    const sten = toSten(test.scoring.stens[s] ?? [], raw);
    stenByScale[s] = sten;
    percentByScale[s] = Math.round((sten / 10) * 100);
  }

  const levelForSten = (sten: number) => {
    if (sten <= 4) return "экстернальность";
    if (sten <= 6) return "средний уровень";
    return "интернальность";
  };

  const ranked: ScoreRow[] = scales
    .map((s) => ({
      tag: s,
      style: test.scoring.scale_to_name[s] ?? s,
      count: stenByScale[s],
      percent: percentByScale[s],
      level: levelForSten(stenByScale[s]),
    }))
    ;

  return {
    kind: "usk_v1",
    total: 10,
    counts: stenByScale as any,
    percents: percentByScale as any,
    ranked,
    meta: {
      rawByScale,
      stenByScale,
      note: "count=stens (1..10), percent=stens*10",
    },
  };
}


// ===================== 16PF =====================

function normalizeABCtoKeyLetter(v: any): "a" | "b" | "c" | null {
  const s = String(v || "").trim().toUpperCase();
  if (s === "A") return "a";
  if (s === "B") return "b";
  if (s === "C") return "c";
  // also allow raw key letters
  const t = String(v || "").trim().toLowerCase();
  if (t === "a" || t === "b" || t === "c") return t as any;
  // Cyrillic support: "В" / "в" acts as "b", "С" / "с" acts as "c"
  if (t === "в") return "b";
  if (t === "с") return "c";
  return null;
}

function levelFor010(score: number, lowMax: number, midMax: number) {
  const x = Math.max(0, Math.min(10, Math.round(score)));
  if (x <= lowMax) return "низкий";
  if (x <= midMax) return "средний";
  return "высокий";
}

/**
 * 16PF (Cattell, forms A/B - 187 items) scoring used in many Russian hand-scoring guides:
 * - Each keyed item: if the respondent answer matches the key,
 *   then answers "a" and "c" are counted as 2 points, answer "b" as 1 point.
 * - Exception: Factor B counts any keyed match as 1 point.
 * - After raw scoring, each factor is converted to STEN (1..10) using the norm table for Forms A/B.
 * - Levels: 0..4 low, 5..7 medium, 8..10 high (configurable via thresholds_0_10).
 * - Question 187 is allowed in UI but ignored by key by design.
 */
export type PF16Submission = {
  pf16: Array<ABC | "">;
  gender?: Pf16Gender | null;
  age?: number | null;
};

export function score16PF(
  test: PF16TestV1,
  answersOrSubmission: Array<ABC | ""> | PF16Submission
): ScoreResult {
  const submission: PF16Submission = Array.isArray(answersOrSubmission)
    ? { pf16: answersOrSubmission }
    : answersOrSubmission;

  const answers = submission.pf16;
  const gender = submission.gender ?? null;
  const age = typeof submission.age === "number" ? submission.age : null;

  const keys = test.scoring.keys;
  const factors = test.scoring.factors;

  const counts: Record<string, number> = {};
  const stenByFactor: Record<string, number> = {};
  const rawByFactor: Record<string, number> = {};
  const maxStenByFactor: Record<string, number> = {};
  const maxRawByFactor: Record<string, number> = {};

  for (const f of factors) {
    rawByFactor[f] = 0;
    maxStenByFactor[f] = 10;
    maxRawByFactor[f] = 0;
  }

  // raw scoring
  for (const f of factors) {
    const items = keys[f] || [];
    for (const item of items) {
      const qIndex = (item.q || 0) - 1;

      const accept = (item.accept || []).map((x: string) => String(x).toLowerCase());
      const accepts = (x: string) => accept.includes(String(x).toLowerCase());

      // Determine theoretical max points from key itself
      let maxPoints = 0;
      if (f === "B") {
        maxPoints = 1;
      } else {
        if (accept.length === 1) maxPoints = 1;
        else if (accept.length >= 2) maxPoints = 2;
        else maxPoints = 0;
      }
      maxRawByFactor[f] += maxPoints;

      // If answer is missing/out of range — RAW doesn't increase
      if (qIndex < 0 || qIndex >= answers.length) continue;
      const ans = normalizeABCtoKeyLetter(answers[qIndex] || "");
      if (!ans) continue;

      // Score points
      let pts = 0;
      if (f === "B") {
        if (accepts(ans)) pts = 1;
      } else {
        if (accept.length === 1) {
          if (accepts(ans)) pts = 1;
        } else if (accept.length >= 2) {
          if (accepts(ans)) pts = ans === "b" ? 1 : 2;
        }
      }

      rawByFactor[f] += pts;
    }
  }

  const normGroup = gender && age !== null ? pf16PickNormGroup(gender, age) : "common";
  const normGroupLabel = pf16NormGroupLabel(normGroup);

  // convert raw -> sten
  for (const f of factors) {
    const raw = rawByFactor[f] ?? 0;
    const sten = pf16RawToSten(normGroup, f, raw);
    stenByFactor[f] = sten;
    counts[f] = sten;
  }

  const rows: ScoreRow[] = factors.map((f) => {
    const count = counts[f] ?? 0;
    const max = maxStenByFactor[f] ?? 10;
    const percent = max ? Math.round((count / max) * 100) : 0;
    const label = (test.scoring.factor_to_name as any)?.[f] ?? f;
    return {
      tag: f,
      style: label,
      count,
      percent,
      level: levelFor010(
        count,
        test.scoring.thresholds_0_10.low_max,
        test.scoring.thresholds_0_10.mid_max
      ),
    };
  });

  // Secondary factors (F1..F4) computed from primary STENs (per методичка)
  const s = (k: string) => stenByFactor[k] ?? 5;
  const clamp010 = (x: number) => Math.max(1, Math.min(10, x));
  const round2 = (x: number) => Math.round(x * 100) / 100;

  const F1 = round2(
    clamp010(
      ((38 + 2 * s("L") + 3 * s("O") + 4 * s("Q4")) - 2 * (s("C") + s("H") + s("Q3"))) / 10
    )
  );
  const F2 = round2(
    clamp010(
      ((2 * s("A") + 3 * s("E") + 4 * s("F") + 5 * s("H")) - (2 * s("Q2") + 11)) / 10
    )
  );
  const F3 = round2(
    clamp010(
      ((77 + 2 * s("C") + 2 * s("E") + 2 * s("F") + 2 * s("N")) - (4 * s("A") + 6 * s("I") + 2 * s("M"))) / 10
    )
  );
  const F4 = round2(
    clamp010(
      ((4 * s("E") + 3 * s("M") + 4 * s("Q1") + 4 * s("Q2")) - (3 * s("A") + 2 * s("G"))) / 10
    )
  );

  const secondary = {
    F1: {
      tag: "F1",
      count: F1,
      level: levelFor010(F1, test.scoring.thresholds_0_10.low_max, test.scoring.thresholds_0_10.mid_max),
    },
    F2: {
      tag: "F2",
      count: F2,
      level: levelFor010(F2, test.scoring.thresholds_0_10.low_max, test.scoring.thresholds_0_10.mid_max),
    },
    F3: {
      tag: "F3",
      count: F3,
      level: levelFor010(F3, test.scoring.thresholds_0_10.low_max, test.scoring.thresholds_0_10.mid_max),
    },
    F4: {
      tag: "F4",
      count: F4,
      level: levelFor010(F4, test.scoring.thresholds_0_10.low_max, test.scoring.thresholds_0_10.mid_max),
    },
  };

  const total = answers.length;
  const percents: Record<string, number> = Object.fromEntries(
    factors.map((f) => [f, Math.round(((counts[f] ?? 0) / 10) * 100)] as const)
  ) as any;

  return {
    kind: "16pf_v1",
    title: test.title,
    summary: `Профиль сформирован. Нормы: ${normGroupLabel}.`,
    total,
    counts,
    percents,
    ranked: rows,
    meta: {
      counts,
      maxByFactor: maxStenByFactor,
      stenByFactor,
      rawByFactor,
      maxRawByFactor,
      gender,
      age,
      normGroup,
      normGroupLabel,
      secondary,
    },
  };
}
